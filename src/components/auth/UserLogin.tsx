import { useState } from "react";
import { ChefHat, User, Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import { useSessionStore } from "@/lib/authStore";
import { useNavigate } from "@tanstack/react-router";

export function UserLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isShaking, setIsShaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const loginUser = useSessionStore((s) => s.loginUser);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    setIsLoading(true);
    setError("");

    const result = await loginUser(username, password);

    if (result.ok) {
      // Keep spinner alive through navigation — do NOT setIsLoading(false)
      if (result.isAdmin) {
        navigate({ to: "/admin" });
      } else {
        navigate({ to: "/tables" });
      }
      return;
    }

    // Only stop loader on failure
    setIsLoading(false);
    setError(result.error ?? "Erreur de connexion.");
    setIsShaking(true);
    setPassword("");
    setTimeout(() => setIsShaking(false), 600);
    inputRef.current?.focus();
  }

  return (
    <div className="admin-login-root">
      {/* Animated background blobs (reusing the same styles from AdminLogin) */}
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
          <p className="admin-login-subtitle">Connexion Employé</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="admin-login-form mt-4">
          
          <div className="flex flex-col gap-1">
            <label className="admin-login-label" htmlFor="pos-username">
              <User size={13} />
              Nom d'utilisateur
            </label>
            <div className="admin-login-input-wrap">
              <input
                id="pos-username"
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(""); }}
                placeholder="ex: marie"
                className="admin-login-input"
                autoComplete="username"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 mt-2">
            <label className="admin-login-label" htmlFor="pos-password">
              <Lock size={13} />
              Mot de passe
            </label>
            <div className="admin-login-input-wrap">
              <input
                id="pos-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="••••••••"
                className="admin-login-input pr-10"
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
          </div>

          {error && (
            <div className="admin-login-error mt-2">
              <AlertCircle size={13} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="admin-login-btn mt-4"
            disabled={isLoading || !username.trim() || !password.trim()}
          >
            {isLoading ? (
              <>
                <span className="admin-login-spinner" />
                <span style={{ marginLeft: 8 }}>Connexion…</span>
              </>
            ) : (
              "Se connecter"
            )}
          </button>
        </form>

        <p className="admin-login-footer mt-4">
          © {new Date().getFullYear()} Z-pekenio · Système de caisse
        </p>
      </div>
    </div>
  );
}
