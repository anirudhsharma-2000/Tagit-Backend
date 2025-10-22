// jobs/availabilityScheduler.js
import cron from 'node-cron';
import mongoose from 'mongoose';
import Allocation from '../models/Allocation.js';
import Asset from '../models/Asset.js';

const LOG_PREFIX = '[availabilityScheduler]';

/**
 * Parse a date that may be in "dd/mm/yyyy" or ISO format.
 * Returns a valid Date object or null if invalid.
 */
function parseDateFlexible(dateValue) {
  if (!dateValue) return null;

  // If already a Date object, return it directly
  if (dateValue instanceof Date) return dateValue;

  // If it's a number or something parseable as timestamp
  if (!isNaN(Date.parse(dateValue))) return new Date(dateValue);

  // If string like "dd/mm/yyyy"
  if (typeof dateValue === 'string') {
    const parts = dateValue.split(/[\/\-]/);
    if (parts.length === 3) {
      const [day, month, year] = parts.map(Number);
      if (year && month && day) {
        return new Date(year, month - 1, day); // JS months are 0-indexed
      }
    }
  }

  return null; // invalid
}

/**
 * Check allocations and mark expired ones' assets available.
 */
async function processExpiredAllocations() {
  try {
    const now = new Date();

    // Get approved allocations that have a duration endTime
    const allocations = await Allocation.find({
      status: 'approved',
      'duration.endTime': { $exists: true },
    });

    for (const alloc of allocations) {
      const endTime = parseDateFlexible(alloc.duration?.endTime);

      if (!endTime) {
        console.warn(
          `${LOG_PREFIX} Skipping allocation ${alloc._id} - invalid endTime`,
          alloc.duration?.endTime
        );
        continue;
      }

      if (endTime <= now) {
        try {
          // Mark asset available again
          if (alloc.asset) {
            await Asset.findByIdAndUpdate(
              alloc.asset,
              { availablity: true },
              { new: true }
            );
          }

          // Mark allocation completed
          alloc.status = 'completed';
          alloc.allocationStatusDate = now;
          await alloc.save();

          console.log(
            `${LOG_PREFIX} ✅ Allocation ${alloc._id} completed — asset set available`
          );
        } catch (err) {
          console.error(
            `${LOG_PREFIX} ❌ Failed updating asset for allocation ${alloc._id}:`,
            err
          );
        }
      }
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Error running scheduler:`, err);
  }
}

export function startAvailabilityScheduler() {
  // Every minute — adjust if needed
  const task = cron.schedule('*/10 * * * *', async () => {
    await processExpiredAllocations();
  });

  task.start();
  console.log(`${LOG_PREFIX} Scheduler started (checks every 10 minute)`);
  return task;
}
