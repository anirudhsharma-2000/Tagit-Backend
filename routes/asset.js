import express from 'express';
import {
  createAsset,
  updateAsset,
  deleteAsset,
  getAssetListById,
  getAssetDetailsById,
  getAssets,
} from '../controllers/asset.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router
  .route('/')
  .post(protect, authorize('admin', 'purchaser'), createAsset)
  .get(protect, getAssets);
router
  .route('/:id')
  .put(protect, authorize('admin', 'purchaser'), updateAsset)
  .delete(protect, authorize('admin', 'purchaser'), deleteAsset)
  .get(protect, getAssetListById);

router.route('/detail/:id').get(protect, getAssetDetailsById);

export default router;
