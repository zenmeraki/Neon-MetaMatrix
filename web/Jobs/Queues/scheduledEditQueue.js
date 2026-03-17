import { Queue } from "bullmq";
import IORedis from "ioredis";

import { connection } from "../../Config/redis.js";


export const scheduledEditQueue = new Queue("scheduled-edit-queue", {
  connection,
});
