# Ava Kerolos Rewards

A bilingual German/Arabic Progressive Web App (PWA) for the Ava Kerolos Sunday School rewards programme.

## Scope and architecture

- **Separate application:** this repository is independent of the Biblereise app.
- **First integration:** Bible Challenge results only.
- **Future integration:** Bible Escape Room can be considered after the first integration is proven reliable.
- **Backend target:** the existing Firebase project `bible-escape-room`; no Firebase configuration or production data is included in this repository.
- **Student access:** individual student code plus PIN; no student email required.
- **Student-facing languages:** German and Arabic.

## Important security principles

1. Never trust points or answer correctness supplied by the browser.
2. Award points only after a trusted server-side process validates an eligible Bible Challenge result.
3. Prevent duplicate awards with an idempotent transaction design.
4. Keep student profiles and reward records private; collect only data the programme needs.
5. Do not commit Firebase service-account credentials, private keys, student data, or PINs.
6. Keep existing Biblereise authentication and Firestore rules unchanged until the integration is reviewed and tested.

## Planned milestones

1. PWA foundation and accessible bilingual interface.
2. Student-code/PIN authentication design.
3. Firebase data model and least-privilege security rules.
4. Trusted result-validation and points-awarding pipeline.
5. Teacher tools, reward catalogue, and redemption workflow.
6. Test in a non-production flow before connecting the live Bible Challenge.

## Current status

The initial interface is a **front-end prototype only**. Login and dashboard interactions are demonstrations; Firebase authentication, student accounts, points, and rewards are not connected yet.

## Deployment

The app can be hosted as a static PWA (for example, GitHub Pages). Configure GitHub Pages after the prototype and repository visibility have been reviewed. Do not use this prototype with real student information.
