import { Router, type IRouter } from "express";
import healthRouter from "./health";
import invoicesRouter from "./invoices";
import moderationRouter from "./moderation";
import paymentsRouter from "./payments";
import policiesRouter from "./policies";
import signalRankRouter from "./signalrank";
import sponsorshipsRouter from "./sponsorships";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(signalRankRouter);
router.use(paymentsRouter);
router.use(invoicesRouter);
router.use(moderationRouter);
router.use(policiesRouter);
router.use(sponsorshipsRouter);
router.use(storageRouter);

export default router;
