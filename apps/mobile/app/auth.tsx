/**
 * Login y registro.
 *
 * La validación es la del diseño: correo con formato válido y contraseña de al
 * menos 8 caracteres; en registro, además, nombre y la casilla de 18+.
 */

import { Button, Checkbox, Field, Txt, useTheme } from '@wagerwise/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GoogleMark } from '@/components/GoogleMark';
import { Logo } from '@/components/Logo';
import { useAuth } from '@/lib/auth';

type Mode = 'login' | 'register';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const MIN_PASSWORD_LENGTH = 8;

export default function AuthRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ mode?: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword } = useAuth();

  const [mode, setMode] = useState<Mode>(params.mode === 'register' ? 'register' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isRegister = mode === 'register';

  // Los errores sólo se muestran una vez el campo tiene contenido, para no
  // recibir al usuario con todo en rojo.
  const emailError = email.length > 0 && !EMAIL_PATTERN.test(email) ? 'Correo no válido' : null;
  const passwordError =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH
      ? `Mínimo ${MIN_PASSWORD_LENGTH} caracteres`
      : null;

  const valid = useMemo(() => {
    const base = EMAIL_PATTERN.test(email) && password.length >= MIN_PASSWORD_LENGTH;
    return isRegister ? base && name.trim().length > 1 && agreed : base;
  }, [email, password, name, agreed, isRegister]);

  async function submit(): Promise<void> {
    if (!valid || submitting) return;
    setSubmitting(true);
    setFormError(null);
    setNotice(null);

    try {
      if (isRegister) {
        await signUpWithEmail(email, password, name);
        // Si el proyecto exige confirmar el correo no habrá sesión todavía; el
        // redirector del layout se encarga cuando la haya.
        setNotice('Cuenta creada. Si te pedimos confirmar el correo, revisa tu bandeja.');
      } else {
        await signInWithEmail(email, password);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo completar la operación.');
    } finally {
      setSubmitting(false);
    }
  }

  async function google(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await signInWithGoogle();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo entrar con Google.');
    } finally {
      setSubmitting(false);
    }
  }

  async function forgot(): Promise<void> {
    if (!EMAIL_PATTERN.test(email)) {
      setFormError('Escribe tu correo para enviarte el enlace de recuperación.');
      return;
    }
    try {
      await resetPassword(email);
      setNotice('Te enviamos un enlace para restablecer la contraseña.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo enviar el enlace.');
    }
  }

  function switchMode(): void {
    setMode(isRegister ? 'login' : 'register');
    setPassword('');
    setFormError(null);
    setNotice(null);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Volver"
            style={styles.header}
          >
            <Logo size={38} />
            <Txt variant="title" style={styles.brand}>
              WagerWise
            </Txt>
          </Pressable>

          <View style={styles.intro}>
            <Txt variant="display">{isRegister ? 'Crea tu cuenta' : 'Bienvenido de vuelta'}</Txt>
            <Txt variant="body" tone="ink2" style={styles.introBody}>
              {isRegister
                ? 'Sin comisiones. Analiza, audita y registra tus apuestas.'
                : 'Entra para ver los partidos de hoy y tus parlays guardados.'}
            </Txt>
          </View>

          <Button
            label={isRegister ? 'Registrarse con Google' : 'Continuar con Google'}
            variant="glass"
            onPress={() => void google()}
            icon={<GoogleMark />}
          />

          <View style={styles.separator}>
            <View style={[styles.rule, { backgroundColor: theme.colors.hair }]} />
            <Txt variant="overline" tone="ink3" uppercase>
              o con correo
            </Txt>
            <View style={[styles.rule, { backgroundColor: theme.colors.hair }]} />
          </View>

          <View style={styles.form}>
            {isRegister ? (
              <Field
                placeholder="Nombre completo"
                value={name}
                onChangeText={setName}
                autoComplete="name"
                textContentType="name"
              />
            ) : null}

            <Field
              placeholder="tu@correo.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              error={emailError}
            />

            <Field
              placeholder={`Contraseña (mín. ${MIN_PASSWORD_LENGTH} caracteres)`}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              textContentType={isRegister ? 'newPassword' : 'password'}
              error={passwordError}
            />

            {isRegister ? (
              <Checkbox
                checked={agreed}
                onToggle={() => setAgreed((v) => !v)}
                label="Tengo 18 años o más y acepto los términos y la política de juego responsable."
              />
            ) : (
              <Pressable
                onPress={() => void forgot()}
                accessibilityRole="button"
                style={styles.forgot}
              >
                <Txt variant="bodySmall" tone="accent">
                  ¿Olvidaste tu contraseña?
                </Txt>
              </Pressable>
            )}

            {formError ? (
              <Txt variant="caption" tone="bad" style={styles.feedback}>
                {formError}
              </Txt>
            ) : null}
            {notice ? (
              <Txt variant="caption" tone="good" style={styles.feedback}>
                {notice}
              </Txt>
            ) : null}

            <Button
              label={isRegister ? 'Crear cuenta' : 'Iniciar sesión'}
              onPress={() => void submit()}
              disabled={!valid || submitting}
            />
            {submitting ? (
              <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
            ) : null}
          </View>

          <View style={styles.footer}>
            <Txt variant="bodySmall" tone="ink2">
              {isRegister ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?'}
            </Txt>
            <Pressable onPress={switchMode} accessibilityRole="button">
              <Txt variant="bodySmall" tone="accent" style={styles.switchLink}>
                {isRegister ? 'Inicia sesión' : 'Regístrate'}
              </Txt>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 22, paddingBottom: 30, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 52 },
  brand: { letterSpacing: -0.16 },
  intro: { gap: 10 },
  introBody: { maxWidth: 290 },
  separator: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  form: { gap: 11 },
  forgot: { paddingVertical: 8, paddingHorizontal: 4, minHeight: 44, justifyContent: 'center' },
  feedback: { paddingHorizontal: 4 },
  spinner: { marginTop: 8 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 'auto',
    paddingTop: 20,
  },
  switchLink: { fontWeight: '600' },
});
