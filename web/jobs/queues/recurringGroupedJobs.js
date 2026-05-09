import { Queue, tryCatch } from "bullmq";
import { connection } from "../../config/redis.js";
import { createLazyQueueProxy } from "../../utils/jobQueueUtils.js";
import logger from "../../utils/loggerUtils.js";

let groupedQueueInstance = null;

function getGroupedQueue() {
  if (!groupedQueueInstance) {
    groupedQueueInstance = new Queue(process.env.RECURRING_QUEUE, {
      connection,
    });
  }

  return groupedQueueInstance;
}

const groupedQueue = createLazyQueueProxy(getGroupedQueue);

export const timeSlots = generateTimeSlots(); // every 15 min in HH:mm

const TIMEZONES = [
  "Asia/Kolkata",
  // "UTC",
  // "America/New_York",
  // "Europe/London",
  // "Asia/Tokyo",
];

const FREQUENCIES = ["Daily", "Weekly", "Monthly", "Hourly", "Every 2 Hours"];
const WEEKDAYS = ["0", "1", "2", "3", "4", "5", "6"]; // Sunday to Saturday
const DAYS_IN_MONTH = Array.from({ length: 31 }, (_, i) => i + 1); // 1–31

export const registerGroupedRecurringJobs = async () => {
try {
  const queue = getGroupedQueue();

  // Clear existing jobs to avoid duplicates
  await queue.obliterate({ force: true });

  for (const timezone of TIMEZONES) {
    for (const frequency of FREQUENCIES) {
      // Handle Hourly and Every 2 Hours frequencies
      if (["Hourly", "Every 2 Hours"].includes(frequency)) {
        const jobId = `group-${frequency}-${timezone}`;
        const cronExpression = getCronForFrequency(frequency);


        await queue.add(
          jobId,
          { frequency, timezone },
          {
            repeat: {
              pattern: cronExpression,
              tz: timezone,
            },
            removeOnComplete: 10,
            removeOnFail: 5,
            jobId,
          }
        );


      }

      // Handle Daily frequency
      if (frequency === "Daily") {
        for (const time of timeSlots) {
          const jobId = `group-Daily-${time}-${timezone}`;
          const cronExpression = getCronFromTime("Daily", time);


          await queue.add(
            jobId,
            { frequency: "Daily", timeToRun: time, timezone },
            {
              repeat: {
                pattern: cronExpression,
                tz: timezone,
              },
              removeOnComplete: 10,
              removeOnFail: 5,
              jobId,
            }
          );
        }

      }

      // Handle Weekly frequency
      if (frequency === "Weekly") {
        for (const day of WEEKDAYS) {
          for (const time of timeSlots) {
            const jobId = `group-Weekly-${day}-${time}-${timezone}`;
            const cronExpression = getCronForWeekly(time, day);


            await queue.add(
              jobId,
              {
                frequency: "Weekly",
                dayOfWeek: Number(day),
                timeToRun: time,
                timezone,
              },
              {
                repeat: {
                  pattern: cronExpression,
                  tz: timezone,
                },
                removeOnComplete: 10,
                removeOnFail: 5,
                jobId,
              }
            );
          }
        }

      }

      // Handle Monthly frequency
      if (frequency === "Monthly") {
        for (const day of DAYS_IN_MONTH) {
          for (const time of timeSlots) {
            const jobId = `group-Monthly-${day}-${time}-${timezone}`;
            const cronExpression = getCronForMonthly(time, day);

           

            await queue.add(
              jobId,
              {
                frequency: "Monthly",
                dayOfMonth: day,
                timeToRun: time,
                timezone,
              },
              {
                repeat: {
                  pattern: cronExpression,
                  tz: timezone,
                },
                removeOnComplete: 10,
                removeOnFail: 5,
                jobId,
              }
            );
          }
        }
      }

    }
  }

} catch (error) {

  throw error;
}
};

// Helper functions for cron expressions
function getCronForFrequency(frequency) {
  switch (frequency) {
    case "Hourly":
      return "0 * * * *"; // At minute 0 of every hour
    case "Every 2 Hours":
      return "0 */2 * * *"; // At minute 0 of every 2nd hour
    default:
      throw new Error(`Invalid frequency for fixed cron: ${frequency}`);
  }
}

function getCronFromTime(frequency, time) {
  const [hour, minute] = time.split(":").map(Number);

  switch (frequency) {
    case "Daily":
      return `${minute} ${hour} * * *`; // At specific time every day
    default:
      throw new Error(`Invalid frequency for time-based cron: ${frequency}`);
  }
}

function getCronForWeekly(time, dayOfWeek) {
  const [hour, minute] = time.split(":").map(Number);
  return `${minute} ${hour} * * ${dayOfWeek}`; // At specific time on specific day of week
}

function getCronForMonthly(time, dayOfMonth) {
  const [hour, minute] = time.split(":").map(Number);
  return `${minute} ${hour} ${dayOfMonth} * *`; // At specific time on specific day of month
}

function getCronFromTimeOnly(time) {
  const [hour, minute] = time.split(":").map(Number);
  return `${minute} ${hour}`;
}

function generateTimeSlots() {
  const slots = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      slots.push(`${hh}:${mm}`);
    }
  }
  return slots;
}

// Utility function to check registered jobs (for debugging)
export const listRegisteredJobs = async () => {
  const queue = getGroupedQueue();
  const jobs = await queue.getJobs([
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
  ]);
  const repeatableJobs = await queue.getRepeatableJobs();

  return { totalJobs: jobs.length, repeatableJobs: repeatableJobs.length };
};

// Function to remove all jobs (useful for cleanup)
export const clearAllJobs = async () => {
  await getGroupedQueue().obliterate({ force: true });

};
