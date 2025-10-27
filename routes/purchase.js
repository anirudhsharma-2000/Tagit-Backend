import express from 'express';
import {
  createRequest,
  updateRequest,
  getRequests,
  getAllRequests,
} from '../controllers/purchase.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.route('/').post(protect, createRequest).get(protect, getAllRequests);
router
  .route('/:id')
  .get(protect, getRequests);

router.put(
  '/request/:id',
  protect,
  authorize('admin', 'purchaser'),
  updateRequest
);

export default router;
