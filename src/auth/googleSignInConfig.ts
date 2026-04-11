import { googleLogout } from '@react-oauth/google';

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
