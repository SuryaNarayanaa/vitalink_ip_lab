# Firebase phone authentication setup

VitaLink uses Firebase Authentication in the Flutter app to request and confirm
the SMS code. The app sends the resulting Firebase ID token to the backend. The
backend verifies Google's signature and requires the token's `phone_number` to
match the phone stored on the patient or doctor profile.

## Important: development without billing

Without a linked Google Cloud billing account, use Firebase fictional test phone
numbers. They exercise the complete client/backend flow, but Firebase sends no
real SMS. Do not add a hard-coded OTP or server-side bypass.

In Firebase Console:

1. Open **Authentication > Sign-in method** and enable **Phone**.
2. Expand **Phone numbers for testing**.
3. Add a fictional E.164 number, for example `+919000004444`, and a six-digit
   code such as `123456`.
4. Store that same number on the VitaLink test patient or doctor profile.

## Android app registration

The Android package is `com.vitalink.frontend`. In **Project settings > Your
apps > Android app**, confirm that package, add the debug SHA-1 and SHA-256, then
download the refreshed `google-services.json` to:

`frontend/android/app/google-services.json`

From `frontend/android`, print the local fingerprints with:

```powershell
./gradlew signingReport
```

The configuration file contains app identifiers rather than an Admin private
key. This repository ignores it so each environment can supply its own copy.

## iOS app registration

The iOS bundle identifier is configured in the Xcode Runner target. Register
that exact identifier in **Project settings > Your apps > iOS app**, download
`GoogleService-Info.plist`, and place it at:

`frontend/ios/Runner/GoogleService-Info.plist`

Open `frontend/ios/Runner.xcworkspace` in Xcode and add the plist to the Runner
target so it is copied into the application bundle. Firebase phone auth on iOS
also requires APNs configuration (an APNs authentication key uploaded in the
Firebase Console) and the Push Notifications capability. Configure custom URL
schemes if Firebase's current iOS phone-auth setup instructions require them.
The plist is ignored by this repository and must be supplied per environment.

## Backend environment

Copy `backend/.env.example` to `backend/.env`, then set:

```dotenv
FIREBASE_AUTH_ENABLED=true
FIREBASE_PHONE_DEFAULT_COUNTRY_CODE=+91
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"..."}
```

`FIREBASE_PHONE_DEFAULT_COUNTRY_CODE` is prepended only when a stored profile
phone has no leading `+`. Prefer storing all phone numbers in E.164 format.

`FIREBASE_SERVICE_ACCOUNT` must be the full Admin SDK JSON compressed onto one
line. Never commit it. If the service-account JSON is in the repository root and
matches `*-firebase-adminsdk-*.json`, the existing helper safely writes the
settings without printing the key:

```powershell
./setup-firebase-env.cmd
```

For a hosted backend, add those same values in the host's secret/environment
settings. Do not upload the JSON into the app or bundle it in Flutter.

## Run and verify

```powershell
cd backend
npm install
npm run dev
```

In another terminal:

```powershell
cd frontend
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

Use `http://<LAN-IP>:3000` instead of `10.0.2.2` on a physical Android device.
Log in with an unverified patient/doctor whose stored phone equals a configured
Firebase test number, then enter the fixed test code. A successful flow marks
the profile phone verified and returns the normal VitaLink access/refresh tokens.

Real SMS later requires linking billing, reviewing Firebase Auth SMS region and
quota settings, and testing on a real device before enabling production users.
