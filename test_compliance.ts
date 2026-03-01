import { ComplianceService } from './src/services/complianceService';

const svc = new ComplianceService();
svc.loadRules('./resources/default-lexicon.yml');
console.log(`Loaded ${svc.ruleCount} rules.`);

const text = "Look at that babe with big boobs.";
const res = svc.sanitize(text);
console.log("Sanitized:", res.sanitized);
console.log("Hits:", res.hits);

const restored = svc.restore(res.sanitized, res.restoreMap);
console.log("Restored:", restored);
