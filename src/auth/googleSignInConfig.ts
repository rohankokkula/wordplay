import { googleLogout } from '@react-oauth/google';
import type { GoogleLoginProps } from '@react-oauth/google';

/**
 * Shared options for {@link GoogleLogin}:
 * - `auto_select` / `use_fedcm_for_button` → passed to `google.accounts.id.initialize` (via `...props`).
 * - `click_listener` → passed to `renderButton`; we call `googleLogout()` (`disableAutoSelect`) so Google
 *   is less likely to silently reuse only the last signed-in account (e.g. a Workspace session).
 *
 * **If the account picker still skips:** use Incognito, or add every app URL under Google Cloud Console →
 * APIs & Services → Credentials → OAuth 2.0 Client → **Authorized JavaScript origins** (fixes `origin_mismatch`).
 */
export const googleSignInIdProps = {
  auto_select: false,
  use_fedcm_for_button: false,
  click_listener: () => {
    googleLogout();
  },
} as const;

/** Dark UI: filled_black button + host that doesn’t clip the taller “Sign in as …” iframe or show a white panel. */
export const googleLoginUiProps = {
  theme: 'filled_black' as const,
  size: 'large' as const,
  shape: 'pill' as const,
  text: 'signin_with' as const,
  width: 320,
  containerProps: {
    className: 'google-login-container',
    style: {
      /* Intentionally NOT 100% — that stretches the GSI host across the
       * whole card when the parent is a flex child with default stretch. */
      width: 'auto',
      maxWidth: 360,
      height: 'auto',
      minHeight: 48,
      overflow: 'visible',
      display: 'inline-flex',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'transparent',
    },
  } satisfies GoogleLoginProps['containerProps'],
};
