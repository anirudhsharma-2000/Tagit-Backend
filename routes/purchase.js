import express from 'express';
import {
  createRequest,
  updateManagerRequest,
  updateRequest,
  getRequests,
  getAllRequests,
} from '../controllers/purchase.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.route('/').post(protect, createRequest).get(protect, getAllRequests);
router
  .route('/:id')
  .put(protect, updateManagerRequest)
  .get(protect, getRequests);

router.put(
  '/request/:id',
  protect,
  authorize('admin', 'purchaser'),
  updateRequest
);

export default router;
