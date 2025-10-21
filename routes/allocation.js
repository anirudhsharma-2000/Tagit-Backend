import express from 'express';
import {
  createAllocation,
  getAllocationById,
  updateAllocation,
  getAllocations,
  getAllocationByAssetId,
  getAllocationByUserId,
  approveAllocation,
  rejectAllocation,
} from '../controllers/allocation.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

// @route   POST /api/v1/allocation
// @route   GET  /api/v1/allocation
router.route('/').post(protect, createAllocation).get(protect, getAllocations);

// @route   GET /api/v1/allocation/:id
// @route   PUT /api/v1/allocation/:id
router
  .route('/:id')
  .get(protect, getAllocationById)
  .put(protect, updateAllocation);

// @route   GET /api/v1/allocation/user/:id
router.route('/user/:id').get(protect, getAllocationByUserId);

// @route   GET /api/v1/allocation/asset/:id
router.route('/asset/:id').get(protect, getAllocationByAssetId);

// ✅ New Routes for approval/rejection mechanism
// @route   PUT /api/v1/allocation/:id/approve
router.route('/:id/approve').put(protect, approveAllocation);

// @route   PUT /api/v1/allocation/:id/reject
router.route('/:id/reject').put(protect, rejectAllocation);

export default router;
