import { Worker } from "bullmq";
import { updateProducts } from "../Cron/scheduledEdit.js";
import { connection } from "../../Config/redis.js";

new Worker(
  "scheduled-edit-queue",
  async (job) => {
    console.log("Worker running:", job.name, job.data);

    const isUndo = job.name === "undo-task";
    return await updateProducts(job.data.historyId, isUndo);
  },
  { connection }
);
