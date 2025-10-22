import express from 'express';
import {
  login,
  getMe,
  refreshToken,
  justCreate,
  modList,
  userList,
  updateUserRole,
} from '../controllers/auth.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', userList);
router.put('/:id/role', protect, authorize('admin'), updateUserRole);
router.post('/login', login);
router.post('/create', justCreate);
router.get('/me', protect, getMe);
router.post('/refresh', refreshToken);
router.get('/modlist', protect, modList);

export default router;
