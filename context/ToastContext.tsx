'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import Toast from '@/components/Toast';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/*
        Fixed toast stack. `role="status"` + `aria-live="polite"` so a screen reader hears
        "Task created" without the toast stealing focus; before this the stack had no live
        region and every confirmation in the app was silent to assistive tech.
        `bottom-24`, not `bottom-6`: the AI Copilot launcher sits at bottom-6 right-6, and the
        two overlapped — the toast's close button landed on top of the launcher.
      */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-24 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none"
      >
        {toasts.map(toast => (
          <Toast 
            key={toast.id} 
            message={toast.message} 
            type={toast.type} 
            onClose={() => removeToast(toast.id)} 
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
