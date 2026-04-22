import React from 'react';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { MainLayout } from './components';
import { Landing } from './components/Landing';
import { AliceSwap } from './components/AliceSwap';
import { BobSwap } from './components/BobSwap';
import { Browse } from './components/Browse';
import { Reclaim } from './components/Reclaim';
import { MintUsdc } from './components/MintUsdc';
import { HowTo } from './components/HowTo';
import { Dashboard } from './components/Dashboard';

const App: React.FC = () => (
  <BrowserRouter>
    <MainLayout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/alice" element={<AliceSwap />} />
        <Route path="/bob" element={<BobSwap />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/reclaim" element={<Reclaim />} />
        <Route path="/mint-usdc" element={<MintUsdc />} />
        <Route path="/how-to" element={<HowTo />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MainLayout>
  </BrowserRouter>
);

export default App;
