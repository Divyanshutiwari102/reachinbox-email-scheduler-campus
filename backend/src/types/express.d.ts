import 'express';

declare global {
  namespace Express {
    interface Request {
      senderId?: string;
      userEmail?: string;
    }
  }
}

export {};