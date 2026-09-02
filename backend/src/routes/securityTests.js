import { Router } from 'express';
import { SCENARIOS, executeSecurityScenario } from '../services/securityTestService.js';

const router = Router();

// GET /api/security-tests/scenarios — List available attack lab scenarios
router.get('/scenarios', (req, res) => {
  res.json({ scenarios: SCENARIOS });
});

// POST /api/security-tests/run & POST /api/security-tests/:scenarioId — Execute a specific scenario
router.post(['/run', '/:scenarioId'], async (req, res, next) => {
  try {
    const scenario_id = req.params.scenarioId || req.body?.scenario_id || req.body?.scenarioId;
    if (!scenario_id) {
      return res.status(400).json({ error: 'scenario_id is required' });
    }

    const io = req.app.get('io');
    const result = await executeSecurityScenario(scenario_id, io);
    res.json({
      success: true,
      scenario: result,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
