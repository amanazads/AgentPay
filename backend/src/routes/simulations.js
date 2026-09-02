import { Router } from 'express';
import { runBatchSimulation, getSimulationRuns, getSimulationDetail } from '../services/simulationService.js';

const router = Router();

// POST /api/simulations/run — Run 1,000-case simulation benchmark
router.post('/run', async (req, res, next) => {
  try {
    const totalCases = parseInt(req.body.totalCases || req.body.total_cases || req.body.cases || 1000, 10);
    const seed = req.body.seed ? parseInt(req.body.seed, 10) : 42;
    const io = req.app.get('io');

    const result = await runBatchSimulation({
      totalCases,
      seed,
      io,
    });

    res.status(201).json({
      success: true,
      runId: result.runId,
      metrics: result.metrics,
      simulation: result.metrics,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/simulations — List recent simulation runs
router.get('/', async (req, res, next) => {
  try {
    const simulations = await getSimulationRuns();
    res.json({ simulations });
  } catch (err) {
    next(err);
  }
});

// GET /api/simulations/:id — Get details of a specific run
router.get('/:id', async (req, res, next) => {
  try {
    const simulation = await getSimulationDetail(req.params.id);
    res.json({ simulation });
  } catch (err) {
    next(err);
  }
});

export default router;
