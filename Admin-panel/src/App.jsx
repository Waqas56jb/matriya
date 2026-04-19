import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Layout         from './components/Layout.jsx';
import Login          from './pages/Login.jsx';
import ResetPassword  from './pages/ResetPassword.jsx';
import Dashboard      from './pages/Dashboard.jsx';
import Users          from './pages/Users.jsx';
import Sessions       from './pages/Sessions.jsx';
import Analytics      from './pages/Analytics.jsx';
import WhatsApp       from './pages/WhatsApp.jsx';
import Experiments    from './pages/Experiments.jsx';
import System         from './pages/System.jsx';
import Audit          from './pages/Audit.jsx';
import Config         from './pages/Config.jsx';

function PrivateRoute({ children }) {
  const { isAuth } = useAuth();
  return isAuth ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const { isAuth } = useAuth();
  return isAuth ? <Navigate to="/dashboard" replace /> : children;
}

/* Add user-avatar style globally */
const injectStyles = () => {
  const style = document.createElement('style');
  style.textContent = `.user-avatar{width:34px;height:34px;background:var(--accent-grad);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0}`;
  document.head.appendChild(style);
};
injectStyles();

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/reset-password" element={<PublicRoute><ResetPassword /></PublicRoute>} />

        <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard"   element={<Dashboard />}   />
          <Route path="/users"       element={<Users />}       />
          <Route path="/sessions"    element={<Sessions />}    />
          <Route path="/analytics"   element={<Analytics />}   />
          <Route path="/whatsapp"    element={<WhatsApp />}    />
          <Route path="/experiments" element={<Experiments />} />
          <Route path="/system"      element={<System />}      />
          <Route path="/audit"       element={<Audit />}       />
          <Route path="/config"      element={<Config />}      />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </AuthProvider>
  );
}
