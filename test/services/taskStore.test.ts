/**
 * TaskStore unit tests
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TaskStore } from '../../src/taskStore';

// Mock vscode
jest.mock('vscode');

describe('TaskStore', () => {
    let store: TaskStore;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskstore-test-'));
        store = new TaskStore();
        const mockUri = { fsPath: tmpDir, scheme: 'file' } as any;
        await store.initialize(mockUri);
    });

    afterEach(() => {
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should add and retrieve a task', () => {
        const task = store.addTask('/path/to/video.mp4');
        expect(task.id).toBeDefined();
        expect(task.videoPath).toBe('/path/to/video.mp4');
        expect(task.status).toBe('queued');

        const retrieved = store.getTask(task.id);
        expect(retrieved).toBeDefined();
        expect(retrieved!.videoPath).toBe('/path/to/video.mp4');
    });

    it('should list all tasks', () => {
        store.addTask('/video1.mp4');
        store.addTask('/video2.mp4');
        const all = store.getAllTasks();
        expect(all).toHaveLength(2);
    });

    it('should update a task', () => {
        const task = store.addTask('/video.mp4');
        store.updateTask(task.id, { status: 'transcribing', currentPhase: 'transcribing' });

        const updated = store.getTask(task.id);
        expect(updated!.status).toBe('transcribing');
        expect(updated!.currentPhase).toBe('transcribing');
    });

    it('should remove a task', () => {
        const task = store.addTask('/video.mp4');
        expect(store.removeTask(task.id)).toBe(true);
        expect(store.getTask(task.id)).toBeUndefined();
    });

    it('should persist tasks to disk', async () => {
        store.addTask('/video1.mp4');
        store.addTask('/video2.mp4');

        // Create a new store and load
        const store2 = new TaskStore();
        const mockUri = { fsPath: tmpDir, scheme: 'file' } as any;
        await store2.initialize(mockUri);

        expect(store2.getAllTasks()).toHaveLength(2);
        store2.dispose();
    });

    it('should clean stale tasks (missing video files)', () => {
        // Add a task with non-existent video path
        store.addTask('/nonexistent/video.mp4');
        const count = store.cleanStaleTasks();
        expect(count).toBe(1);
        expect(store.getAllTasks()).toHaveLength(0);
    });

    it('should not clean tasks with existing video files', () => {
        // Create a temporary file to simulate existing video
        const videoPath = path.join(tmpDir, 'existing.mp4');
        fs.writeFileSync(videoPath, 'fake video');

        store.addTask(videoPath);
        const count = store.cleanStaleTasks();
        expect(count).toBe(0);
        expect(store.getAllTasks()).toHaveLength(1);
    });
});
