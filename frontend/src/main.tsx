import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Refined from './refined';
import './index.css';
createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><Routes>
    <Route path="/refined/*" element={<Refined />} />
    <Route path="*" element={<Navigate to="/refined/home" replace />} />
  </Routes></BrowserRouter></StrictMode>,
);
