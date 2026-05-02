import { Worker } from "bullmq";
import moment from "moment-timezone";
import { connection } from "../../Config/redis.js";
import { getSession } from "../../utils/sessionHandler.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import logger from "../../utils/loggerUtils.js";
import ProductBulkService from "../../services/productBulkUpdateServices/ProductBulkService.js";
import RecurringEdit from "../../schema/recurringEdit.js";
// Helper function to convert day number to day name
const getDayName = (dayNumber) => {
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return dayNames[dayNumber];
};

// Initialize Worker
const worker = new Worker(
  process.env.RECURRING_QUEUE,
  async (job) => {
    const startTime = Date.now();

    try {
      const { frequency, timezone, timeToRun, dayOfMonth, dayOfWeek } =
        job.data;
      
      // Log current time information for debugging
      const now = moment().tz(timezone);
      const currentHHMM = now.format("HH:mm");
      const currentDayOfMonth = now.date(); // 1-31
      const currentDayOfWeek = now.day(); // 0-6 (Sunday=0)
      const currentDayOfWeekName = now.format("dddd"); // 'Monday', 'Tuesday', etc.


      // Build filters for RecurringEdit query
      const filters = {
        frequency,
        timezone,
        status: "Active",
      };

      // Apply frequency-specific filters using job data, not current time
      if (frequency === "Daily" && timeToRun) {
        filters.timeToRun = timeToRun;
      }

      if (frequency === "Weekly" && dayOfWeek !== undefined && timeToRun) {
        filters.timeToRun = timeToRun;
        // Assuming your schema stores day names or you need to convert
        filters.daysOfWeekToRun = getDayName(dayOfWeek);

      }

      if (frequency === "Monthly" && dayOfMonth !== undefined && timeToRun) {
        filters.timeToRun = timeToRun;
        filters.dayOfMonthToRun = dayOfMonth;

      }

      if (frequency === "Hourly") {
        // For hourly jobs, no additional time filtering needed
      }

      if (frequency === "Every 2 Hours") {
        // For every 2 hours jobs, no additional time filtering needed
      }



      // Fetch matching RecurringEdit jobs
      const edits = await RecurringEdit.find(filters);

      if (edits.length === 0) {
        return { processed: 0, message: "No matching edits found" };
      }

      // Process each edit
      let processedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const edit of edits) {
        const editStartTime = Date.now();

        try {
          await RecurringEdit.findByIdAndUpdate(edit._id, {
            $set: { isCurrentlyRunning: true },
            $inc: { totalRuns: 1 },
          });
          const result = await applySteps(edit);

          const editDuration = Date.now() - editStartTime;

          if (result.skipped) {
            skippedCount++;

            await RecurringEdit.updateOne(
              { _id: edit._id },
              {
                $set: {
                  lastRunAt: new Date(),
                  lastRunStatus: "SKIPPED",
                  lastRunMessage:
                    "Bulk operation skipped; another operation running",
                  durationMs: editDuration,
                  error: null,
                  $inc: { totalRunsSkipped: skippedCount },
                  isCurrentlyRunning: false,
                },
              }
            );
          } else {
            processedCount++;
          

            await RecurringEdit.updateOne(
              { _id: edit._id },
              {
                $set: {
                  lastRunAt: new Date(),
                  lastRunStatus: "SUCCESS",
                  lastRunMessage: `Processed ${edit.steps.length} steps`,
                  durationMs: editDuration,
                  error: null,
                  $inc: { totalRunsSucceseed: 1 },
                },
              }
            );
          }
        } catch (err) {
          errorCount++;
          const editDuration = Date.now() - editStartTime;
        


          await RecurringEdit.updateOne(
            { _id: edit._id },
            {
              $set: {
                lastRunAt: new Date(),
                lastRunStatus: "FAILED",
                lastRunMessage: err.message,
                durationMs: editDuration,
                error: {
                  code: err.code || "PROCESSING_FAILED",
                  message: err.message,
                  details: err.stack,
                  timestamp: new Date(),
                },
                $inc: { totalFails: 1 },
                isCurrentlyRunning: false,
              },
            }
          );


        }
      }

      const totalDuration = Date.now() - startTime;
      const summary = {
        processed: processedCount,
        skipped: skippedCount,
        errors: errorCount,
        total: edits.length,
        durationMs: totalDuration,
      };
      return summary;
    } catch (err) {
      const totalDuration = Date.now() - startTime;
     
      throw err; // Re-throw to mark job as failed
    }
  },
  {
    connection,
    concurrency: 1, // Process up to 5 jobs concurrently
    removeOnComplete: 10,
    removeOnFail: 5,
  }
);

// Processor for edit steps
async function applySteps(edit) {
  try {
    // Get session for the shop
    const session = await getSession(edit.shop);
    if (!session) {
      throw new Error(`Failed to get session for shop: ${edit.shop}`);
    }

    // Check if another bulk operation is already running
    const { status } = await getCurrentBulkOperationStatus(session);

    if (status === "RUNNING") {
      return { skipped: true, reason: "BULK_OPERATION_RUNNING" };
    }

    // Initialize the bulk service
    const service = new ProductBulkService(session);
    let completedSteps = 0;

    // Process each step
    for (const [stepIndex, step] of edit.steps.entries()) {
      const { field, value, editType } = step;

      try {
        // Prepare bulk operation
        const { formattedProducts, jsonlFilePath } = await service._preparingBulkOperation({
          queryFilter: edit.queryFilter,
          editedField: field,
          count: edit.totalItems,
          editedType: editType,
          value,
          historyId: edit._id,
        });

        if ((!formattedProducts || formattedProducts.length === 0) && !jsonlFilePath) {
          continue;
        }

        // Execute bulk operation
        const result = await service._bulkOperationHelper({
          formattedProducts,
          jsonlFilePath,
          editedField: field,
        });

        if (!result?.bulkOperation?.id) {
          throw new Error(
            `Missing bulkOperationId in Shopify response for step ${stepIndex + 1
            }`
          );
        }



        // Update the edit record with the latest bulk operation ID
        await RecurringEdit.findByIdAndUpdate(
          edit._id,
          {
            bulkOperationId: result.bulkOperation.id,
            lastStepCompleted: stepIndex + 1,
          },
          { new: true }
        );

        completedSteps++;
      } catch (stepError) {
       
        // Update edit with step failure info
        await RecurringEdit.findByIdAndUpdate(edit._id, {
          lastStepCompleted: stepIndex,
          lastStepError: {
            stepIndex: stepIndex + 1,
            error: stepError.message,
            timestamp: new Date(),
          },
        });

        // Decide whether to continue or stop on step failure
        // For now, we'll throw to stop processing this edit
        throw new Error(`Step ${stepIndex + 1} failed: ${stepError.message}`);
      }
    }

 

    return {
      success: true,
      completedSteps,
      totalSteps: edit.steps.length,
    };
  } catch (error) {
    
    throw error;
  }
}
if (process.env.NODE_ENV != "production") {
  // Worker event handlers
  worker.on("completed", (job, result) => {
    if (result) {
     logger.info(`✅ Recurring job ${job.id} completed`, result);
    }
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ Recurring job ${job.id} failed:`, err.message);
    logger.error("Recurring job failed", {
      jobId: job.id,
      jobData: job?.data,
      error: err.message,
      stack: err.stack,
    });
  });

  worker.on("error", (err) => {
    console.error("❌ Worker error:", err);
    logger.error("Recurring worker error", {
      error: err.message,
      stack: err.stack,
    });
  });

  worker.on("stalled", (jobId) => {
    console.warn(`⚠️  Job ${jobId} stalled`);
    logger.warn("Recurring job stalled", { jobId });
  });

}
export default worker;
