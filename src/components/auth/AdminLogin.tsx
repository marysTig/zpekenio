import { useState, useRef, useEffect } from "react";
import { ChefHat, Lock, Eye, EyeOff, ShieldCheck, AlertCircle } from "lucide-react";
import { useAuthStore, ADMIN_ROW_ID } from "@/lib/authStore";
import { supabase } from "@/lib/supabase";

interface AdminLoginProps {
  onSuccess: () => void;
}

export function AdminLogin({ onSuccess }: AdminLoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isShaking, setIsShaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const setAdminAuthenticated = useAuthStore((s) => s.setAdminAuthenticated);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    setIsLoading(true);
    setError("");

    try {
      // Always verify against Supabase — never against local cache
      const { data, error: dbError } = await supabase
        .from("pos_users")
        .select("username, password")
        .eq("id", ADMIN_ROW_ID)
        .maybeSingle();

      if (dbError || !data) {
        setIsLoading(false);
        setError("Erreur de connexion au serveur. Réessayez.");
        setIsShaking(true);
        setPassword("");
        setTimeout(() => setIsShaking(false), 600);
        inputRef.current?.focus();
        return;
      }

      const usernameMatch = username.trim().toLowerCase() === data.username.toLowerCase();
      const passwordMatch = password.trim() === data.password;

      if (usernameMatch && passwordMatch) {
        // Keep spinner alive — do NOT setIsLoading(false)
        setAdminAuthenticated(true);
        onSuccess();
      } else {
        // Check if it's a regular employee trying to log in via the admin screen
        const { useSessionStore } = await import("@/lib/authStore");
        const employeeResult = await useSessionStore.getState().loginUser(username, password);
        
        if (employeeResult.ok && !employeeResult.isAdmin) {
          // Keep spinner alive through redirect
          window.location.href = "/tables";
          return;
        }
        
        setIsLoading(false);
        setError("Identifiants incorrects. Veuillez réessayer.");
        setIsShaking(true);
        setPassword("");
        setTimeout(() => setIsShaking(false), 600);
        inputRef.current?.focus();
      }
    } catch (err) {
      console.error(err);
      setIsLoading(false);
      setError("Erreur inattendue. Veuillez réessayer.");
      setIsShaking(true);
      setPassword("");
      setTimeout(() => setIsShaking(false), 600);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="admin-login-root">
      {/* Animated background blobs */}
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />

      {/* Card */}
      <div className={`admin-login-card ${isShaking ? "shake" : ""}`}>

        {/* Logo / brand */}
        <div className="admin-login-brand">
          <div className="admin-login-icon-ring">
            <ChefHat className="admin-login-chef-icon" />
          </div>
          <h1 className="admin-login-title">Z-pekenio</h1>
          <p className="admin-login-subtitle">Panneau d'administration</p>
        </div>

        {/* Shield badge */}
        <div className="admin-login-badge">
          <ShieldCheck size={14} className="admin-login-badge-icon" />
          <span>Accès restreint</span>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="admin-login-form">
          <label className="admin-login-label" htmlFor="admin-username">
            <ShieldCheck size={13} />
            Nom d'utilisateur admin
          </label>
          <div className="admin-login-input-wrap">
            <input
              id="admin-username"
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(""); }}
              placeholder="ex: admin"
              className="admin-login-input mb-3"
              autoComplete="username"
            />
          </div>

          <label className="admin-login-label" htmlFor="admin-password">
            <Lock size={13} />
            Mot de passe administrateur
          </label>

          <div className="admin-login-input-wrap">
            <input
              id="admin-password"
              ref={inputRef}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="••••••••"
              className="admin-login-input"
              autoComplete="current-password"
            />
            <button
              type="button"
              className="admin-login-eye"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showPassword ? "Masquer" : "Afficher"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && (
            <div className="admin-login-error">
              <AlertCircle size={13} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="admin-login-btn"
            disabled={isLoading || !username.trim() || !password.trim()}
          >
            {isLoading ? (
              <>
                <span className="admin-login-spinner" />
                <span style={{ marginLeft: 8 }}>Connexion…</span>
              </>
            ) : (
              "Accéder au panneau"
            )}
          </button>
        </form>

        <p className="admin-login-footer">
          © {new Date().getFullYear()} Z-pekenio · Système de caisse
        </p>
      </div>
    </div>
  );
}
