import express from 'express';
import {
  login,
  getMe,
  refreshToken,
  justCreate,
  modList,
  userList,
  updateUserRole,
  registerFcm,
} from '../controllers/auth.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.post('/register-fcm', protect, registerFcm);
router.get('/', userList);
router.put('/:id/role', protect, authorize('admin'), updateUserRole);
router.post('/login', login);
router.post('/create', justCreate);
router.get('/me', protect, getMe);
router.post('/refresh', refreshToken);
router.get('/modlist', protect, modList);

export default router;
