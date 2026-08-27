import { Router } from 'express';
import { runBatchSimulation, getSimulationRuns, getSimulationDetail } from '../services/simulationService.js';

const router = Router();

// POST /api/simulations/run — Run 1,000-case simulation benchmark
router.post('/run', async (req, res, next) => {
  try {
    const { total_cases = 1000 } = req.body;
    const io = req.app.get('io');
    const result = await runBatchSimulation({
      totalCases: parseInt(total_cases),
      io,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/simulations — List recent simulation runs
router.get('/', async (req, res, next) => {
  try {
    const simulations = await getSimulationRuns();
    res.json({ simulations });
  } catch (err) { next(err); }
});

// GET /api/simulations/:id — Get details of a specific run
router.get('/:id', async (req, res, next) => {
  try {
    const simulation = await getSimulationDetail(req.params.id);
    res.json({ simulation });
  } catch (err) { next(err); }
});

export default router;
