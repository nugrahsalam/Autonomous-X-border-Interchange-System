import { Router, type IRouter } from "express";
import healthRouter from "./health";
import axisRouter from "./axis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(axisRouter);

export default router;
