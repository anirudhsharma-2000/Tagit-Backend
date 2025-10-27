import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import color from 'colors';
import errorHandler from './middleware/errorHandler.js';
import connectDB from './config/db.js';
import path from 'path';
import { startAvailabilityScheduler } from './jobs/availabilityScheduler.js';
import { initFirebaseAdmin } from './utils/firebaseAdmin.js';

dotenv.config({ path: './config/config.env' });

connectDB();

// Route Files
import auth from './routes/auth.js';
import purchase from './routes/purchase.js';
import asset from './routes/asset.js';
import allocation from './routes/allocation.js';

const app = express();

startAvailabilityScheduler();
(async () => {
  await initFirebaseAdmin();
})();
//Body Parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Dev Loggin Middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Set Static Folder
app.use(express.static(path.join(process.cwd(), 'public')));

// Mount Routes
app.use('/api/v1/auth', auth);
app.use('/api/v1/purchase', purchase);
app.use('/api/v1/asset', asset);
app.use('/api/v1/allocation', allocation);

// Error Middleware
app.use(errorHandler);

app.get('/', (req, res) => {
  res.send('Company Backend API Running ✅');
});

const PORT = process.env.PORT || 1000;

const server = app.listen(
  PORT,
  console.log(
    `Server running in ${process.env.NODE_ENV} mode on port ${PORT}`.yellow.bold
  )
);

//  Handle Unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`.red);

  //  Close Server and Exit Process
  server.close(() => process.exit(1));
});
