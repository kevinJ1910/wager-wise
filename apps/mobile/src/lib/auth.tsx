/**
 * Autenticación: Google y correo + contraseña, como el diseño los presenta.
 */

import type { Session, User } from '@supabase/supabase-js';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase.js';

// Necesario para que el navegador se cierre al volver del OAuth.
WebBrowser.maybeCompleteAuthSession();

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** True mientras se restaura la sesión guardada, para no parpadear al login. */
  initializing: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, fullName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitializing(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      initializing,

      async signInWithEmail(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw new Error(translateAuthError(error.message));
      },

      async signUpWithEmail(email, password, fullName) {
        const { error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          // El trigger `handle_new_user` lee este metadato para crear el perfil.
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw new Error(translateAuthError(error.message));
      },

      async signInWithGoogle() {
        const redirectTo = AuthSession.makeRedirectUri({ scheme: 'wagerwise' });

        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error) throw new Error(translateAuthError(error.message));
        if (!data.url) throw new Error('No se pudo iniciar el flujo de Google.');

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type !== 'success') {
          // Cancelar no es un error: el usuario cerró el navegador a propósito.
          if (result.type === 'cancel' || result.type === 'dismiss') return;
          throw new Error('No se pudo completar el inicio de sesión con Google.');
        }

        // El retorno trae los tokens en el fragmento de la URL; hay que
        // pasárselos a Supabase explícitamente porque en móvil no los detecta.
        const params = extractAuthParams(result.url);
        if (params.error_description) throw new Error(params.error_description);
        if (!params.access_token || !params.refresh_token) {
          throw new Error('Google no devolvió una sesión válida.');
        }

        const { error: sessionError } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        if (sessionError) throw new Error(translateAuthError(sessionError.message));
      },

      async resetPassword(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
          redirectTo: AuthSession.makeRedirectUri({ scheme: 'wagerwise', path: 'reset' }),
        });
        if (error) throw new Error(translateAuthError(error.message));
      },

      async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw new Error(translateAuthError(error.message));
      },
    }),
    [session, initializing],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return context;
}

/** Los tokens vuelven en el fragmento (#) o en la query (?), según el flujo. */
function extractAuthParams(url: string): Record<string, string> {
  const result: Record<string, string> = {};
  const [, fragment] = url.split('#');
  const query = url.split('?')[1]?.split('#')[0];

  for (const chunk of [fragment, query]) {
    if (!chunk) continue;
    for (const pair of chunk.split('&')) {
      const [key, value] = pair.split('=');
      if (key && value) result[key] = decodeURIComponent(value);
    }
  }

  return result;
}

/**
 * Mensajes de Supabase traducidos. La app está en español y "Invalid login
 * credentials" en mitad de una pantalla en español es una fuga de implementación.
 */
function translateAuthError(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes('invalid login credentials')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (normalized.includes('email not confirmed')) {
    return 'Confirma tu correo antes de iniciar sesión.';
  }
  if (normalized.includes('user already registered')) {
    return 'Ese correo ya tiene una cuenta. Inicia sesión.';
  }
  if (normalized.includes('password should be at least')) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }
  if (normalized.includes('rate limit') || normalized.includes('too many requests')) {
    return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'Sin conexión. Revisa tu red e inténtalo de nuevo.';
  }

  return message;
}
