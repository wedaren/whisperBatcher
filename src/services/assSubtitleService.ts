/**
 * 双语 ASS 生成服务。
 * 当前只处理“原文 + 一个目标语言”的主双语产物，不扩展到所有组合。
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseSrt } from './srtParser';

function escapeAssText(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/\r?\n/g, '\\N');
}

function toAssTimestamp(srtTime: string): string {
    const match = srtTime.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
    if (!match) {
        return '0:00:00.00';
    }
    const [, hh, mm, ss, ms] = match;
    return `${Number(hh)}:${mm}:${ss}.${ms.slice(0, 2)}`;
}

export class AssSubtitleService {
    async createBilingualAss(
        sourceSrtPath: string,
        translatedSrtPath: string,
        targetLanguage: string,
        outputPath: string
    ): Promise<string> {
        const sourceEntries = parseSrt(fs.readFileSync(sourceSrtPath, 'utf-8'));
        const translatedEntries = parseSrt(fs.readFileSync(translatedSrtPath, 'utf-8'));
        const length = Math.min(sourceEntries.length, translatedEntries.length);

        const header = [
            '[Script Info]',
            'ScriptType: v4.00+',
            'WrapStyle: 2',
            'ScaledBorderAndShadow: yes',
            'YCbCr Matrix: TV.709',
            '',
            '[V4+ Styles]',
            'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
            'Style: Default,Noto Sans CJK SC,42,&H00FFFFFF,&H000000FF,&H00121212,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,32,32,26,1',
            'Style: Source,Noto Sans CJK JP,28,&H00D0D0D0,&H000000FF,&H00121212,&H64000000,0,0,0,0,100,100,0,0,1,1,0,2,32,32,72,1',
            '',
            '[Events]',
            'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ];

        const events: string[] = [];
        for (let index = 0; index < length; index++) {
            const source = sourceEntries[index];
            const translated = translatedEntries[index];
            const start = toAssTimestamp(source.startTime);
            const end = toAssTimestamp(source.endTime);
            events.push(`Dialogue: 0,${start},${end},Source,,0,0,0,,${escapeAssText(source.text)}`);
            events.push(`Dialogue: 1,${start},${end},Default,,0,0,0,,${escapeAssText(translated.text)}`);
        }

        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(outputPath, [...header, ...events].join('\n'), 'utf-8');
        return outputPath;
    }
}
