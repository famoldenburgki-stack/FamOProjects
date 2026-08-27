import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import App from './App';
import Dashboard from './pages/Dashboard';
import InvoiceUpload from './pages/InvoiceUpload';
import InvoiceDetail from './pages/InvoiceDetail';
import DecisionUpload from './pages/DecisionUpload';
import Inbox from './pages/Inbox';
import Submit from './pages/Submit';
import Reminders from './pages/Reminders';
import Settings from './pages/Settings';
import { Spinner } from './components/ui';
import './index.css';

// Die Diagramm-Bibliothek wird nur geladen, wenn die Statistik geöffnet wird.
const Statistics = lazy(() => import('./pages/Statistics'));

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'rechnung-neu', element: <InvoiceUpload /> },
      { path: 'eingang', element: <Inbox /> },
      { path: 'rechnung/:id', element: <InvoiceDetail /> },
      { path: 'bescheid', element: <DecisionUpload /> },
      // Alter Pfad bleibt gültig, führt jetzt auf die zusammengelegte Seite
      { path: 'bescheide', element: <Navigate to="/bescheid" replace /> },
      { path: 'einreichen', element: <Submit /> },
      { path: 'aufgaben', element: <Reminders /> },
      {
        path: 'statistik',
        element: (
          <Suspense fallback={<Spinner label="Statistik wird geladen …" />}>
            <Statistics />
          </Suspense>
        ),
      },
      // Der Excel-Import ist entfallen – alte Lesezeichen landen auf der Übersicht
      { path: 'import', element: <Navigate to="/" replace /> },
      { path: 'einstellungen', element: <Settings /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
