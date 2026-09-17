// See SETUP.md for how to get your own Client ID (a free, one-time step on
// Microsoft's site) - paste it below in place of the placeholder. Nothing
// else in this file needs to change.
const MSAL_CLIENT_ID = 'PASTE-YOUR-CLIENT-ID-HERE';

const MSAL_CONFIG = {
    auth: {
        clientId: MSAL_CLIENT_ID,
        // "consumers" restricts sign-in to personal Microsoft accounts
        // (outlook.com/hotmail.com/live.com and similar) - never a work or
        // school account, so this can never collide with any employer's
        // IT policy the way TeaApp.exe did.
        authority: 'https://login.microsoftonline.com/consumers',
        // Must exactly match wherever this page ends up being hosted (see
        // SETUP.md) and must also be registered as a Redirect URI on the
        // app registration itself, or sign-in will fail.
        redirectUri: window.location.origin + window.location.pathname
    },
    cache: {
        // Keeps you signed in across visits/tabs, same as any normal
        // website's "remember me".
        cacheLocation: 'localStorage'
    }
};

// Files.ReadWrite.AppFolder - the narrowest permission that still does the
// job: the app can only read/write its own dedicated folder inside your
// OneDrive (OneDrive > Apps > Steep It Together), never anything else in
// your OneDrive. User.Read just lets it show your name/photo once signed
// in - never anything sensitive.
const MSAL_SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read'];
