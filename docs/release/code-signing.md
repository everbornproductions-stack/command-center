# Windows code signing

Signing is optional. The Windows release workflow signs the Meldmind app executable and the NSIS installer when the Azure secrets below are set. When `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` are absent, signing is skipped and the same workflow still publishes the unsigned installer.

The build uses electron-builder's `win.azureSignOptions` (Azure Trusted Signing, now labeled Artifact Signing in the Azure portal). electron-builder signs `Meldmind.exe`, builds the NSIS installer around that signed app, signs `Meldmind-Setup-<version>.exe`, then writes `latest.yml` and the blockmap from the signed installer. Auto-update checks that sha512. The release job runs `node scripts/verify-latest-yml.mjs` and refuses to upload when the hash or the file size does not match.

This is the same Azure service as the official `azure/trusted-signing-action`. The release does not run that action after the installer exists, because a second signature would change the file and the hash in `latest.yml` would no longer match.

Secret values stay in GitHub Actions secrets. They are not written into `electron-builder.yml`, the app, or the log. Do not commit them, and do not put them in `data\`.

## What to store in GitHub

Open the private source repo, Settings, Secrets and variables, Actions.

https://github.com/everbornproductions-stack/command-center/settings/secrets/actions

Secrets. Leave all three empty until signing is ready. If any one of them is set, the other secrets and the variables below must be set too, or the release stops.

| Name | Where it comes from |
| --- | --- |
| `AZURE_TENANT_ID` | Directory (tenant) ID of the app registration |
| `AZURE_CLIENT_ID` | Application (client) ID of the app registration. This is not the object ID. |
| `AZURE_CLIENT_SECRET` | The secret Value shown once when you create the client secret. This is not the secret ID. |

Repository variables. These are required only when the secrets above are set.

| Name | Where it comes from |
| --- | --- |
| `AZURE_SIGNING_ENDPOINT` | Region endpoint of the Artifact Signing account, such as `https://eus.codesigning.azure.net` |
| `AZURE_SIGNING_ACCOUNT` | Artifact Signing account name |
| `AZURE_CERT_PROFILE` | Certificate profile name |
| `AZURE_PUBLISHER_NAME` | Certificate subject from the certificate profile preview, copied exactly |

`AZURE_PUBLISHER_NAME` is how the installed app checks the next update's signature. Use the full subject from Certificate Subject Preview. A wrong name makes a signed update fail even when the file hash is right.

The pull request workflow (`.github/workflows/windows-ci.yml`) does not receive these secrets. Its installer stays unsigned and is not published.

## Azure setup

Artifact Signing was previously called Trusted Signing. The portal may show either name. The resource provider is still `Microsoft.CodeSigning`. Identity validation for a company is done in the Azure portal. The Azure CLI cannot finish that step.

### 1. Register the resource provider

1. Sign in to the Azure portal.
2. Open Subscriptions and select the subscription that will hold the signing account.
3. Open Settings, Resource providers.
4. Select `Microsoft.CodeSigning`. If the status is NotRegistered, open the ellipsis and select Register.
5. Wait until the status is Registered.

The Azure CLI equivalent is `az provider register --namespace "Microsoft.CodeSigning"`.

### 2. Create the account

1. Search for Artifact Signing Accounts (Trusted Signing accounts, if the portal still uses that name).
2. Select Create.
3. Choose the subscription and a resource group.
4. Choose an account name. It must be 3 to 24 letters or digits, start with a letter, and be unique. That name is the variable `AZURE_SIGNING_ACCOUNT`.
5. Choose a region where Artifact Signing is offered. The endpoint for that region is `AZURE_SIGNING_ENDPOINT`. The endpoint and the account must be in the same region.

| Region | Endpoint |
| --- | --- |
| Brazil South | `https://brs.codesigning.azure.net` |
| Central US | `https://cus.codesigning.azure.net` |
| East US | `https://eus.codesigning.azure.net` |
| Japan East | `https://jpe.codesigning.azure.net` |
| Korea Central | `https://krc.codesigning.azure.net` |
| North Central US | `https://ncus.codesigning.azure.net` |
| North Europe | `https://neu.codesigning.azure.net` |
| Poland Central | `https://plc.codesigning.azure.net` |
| South Central US | `https://scus.codesigning.azure.net` |
| Switzerland North | `https://swn.codesigning.azure.net` |
| West Central US | `https://wcus.codesigning.azure.net` |
| West Europe | `https://weu.codesigning.azure.net` |
| West US | `https://wus.codesigning.azure.net` |
| West US 2 | `https://wus2.codesigning.azure.net` |
| West US 3 | `https://wus3.codesigning.azure.net` |

6. Choose a pricing tier and create the account.

Public Trust certificates are what Windows SmartScreen and a normal installer need. Create the account in a region that can issue them.

### 3. Validate the organization

You need the Artifact Signing Identity Verifier role on the account before the New identity button will work. The portal may still call that role Trusted Signing Identity Verifier. A user with that role also needs Reader on the subscription.

1. Open the Artifact Signing account, then Identity validations.
2. Choose Organization, then New identity, then Public. Public validation is what a Public Trust code signing certificate uses.
3. Enter the legal organization name as it should appear on the certificate.
4. For the business identifier, a US organization uses its EIN. Do not put the EIN in git, in this repo, or in a GitHub log.
5. Enter the organization website, a street address, and two email addresses on a domain the organization owns. The primary mailbox must accept mail from outside the company, because the verification link arrives there and expires after seven days.
6. Open Certificate subject preview and check the name before you create the request.
7. Create the request. The status moves to In Progress, then sometimes to Action Required. Finish whatever the portal or the email asks for. When it succeeds, the status is Completed.

Validation can take from one to several business days. Microsoft may ask for business records issued in the last 12 months. If you change the legal name later, you start a new validation, and certificates already issued keep the old subject until you create a new profile.

### 4. Create the certificate profile

1. On the account, open Certificate profiles, Create, and choose Public Trust.
2. Enter a profile name, 5 to 100 letters or digits, unique in the account. That name is `AZURE_CERT_PROFILE`.
3. For Verified CN and O, select the completed organization validation.
4. Leave Program Type as None.
5. Copy Certificate Subject Preview into the GitHub variable `AZURE_PUBLISHER_NAME` with the same spelling, commas, and spacing.
6. Create the profile.

Azure issues short-lived certificates and rotates them. The release timestamps each signature at `http://timestamp.acs.microsoft.com` so the signature stays valid after the certificate expires.

### 5. Create the app registration

1. Search for App registrations, then New registration.
2. Name it, choose Accounts in this organizational directory only (single tenant), and leave Redirect URI empty.
3. After it is created, copy Application (client) ID into the secret `AZURE_CLIENT_ID`.
4. Copy Directory (tenant) ID into the secret `AZURE_TENANT_ID`.
5. Open Certificates & secrets, New client secret. Copy the Value immediately into the secret `AZURE_CLIENT_SECRET`. The portal shows that value once. The secret ID is not the value.

### 6. Assign the signer role

The app registration is a service principal. The role picker will not list it with users until you search for its name.

1. Open the certificate profile. For a narrower grant, assign the role on the profile. Assigning it on the account also works.
2. Open Access control (IAM), Add, Add role assignment.
3. Choose the role Artifact Signing Certificate Profile Signer. The portal may still show Trusted Signing Certificate Profile Signer. That is the same role.
4. On Members, select User, group, or service principal, and search for the app registration name. Select that app, not your user account.
5. Review and assign.

Without that role, signing fails even when the tenant, client, and secret are correct.

## What the release signs

When the secrets and variables are complete, the Windows release:

1. Signs `dist/win-unpacked/Meldmind.exe` (the app that the installer copies onto the PC).
2. Builds the NSIS installer with that signed app inside it.
3. Signs `dist/Meldmind-Setup-<version>.exe`.
4. Writes `dist/latest.yml` and `dist/Meldmind-Setup-<version>.exe.blockmap` from the signed installer.

The check step then compares the sha512 and the size in `latest.yml` with the installer file. On the Windows runner it also requires a valid Authenticode signature on `Meldmind.exe` and on the installer. If either check fails, the release stops and nothing is uploaded.

The portable exe is signed too when signing is on. It still does not self-update. Only the Setup installer does.

The `winCodeSign` toolset stays pinned at `1.1.0` in `electron-builder.yml`. That pin is what lets a Windows runner unpack the codesign tools. Azure signing uses those tools plus the Trusted Signing PowerShell module, which electron-builder installs for the job when signing is on.

## SmartScreen

A signed installer shows the publisher from the certificate instead of an unknown publisher. SmartScreen can still warn until the file has download reputation. An unsigned installer still uses More info, then Run anyway.

## Microsoft Defender false-positive review

Signing does not by itself stop a false positive. If Defender flags the installer or `Meldmind.exe`, submit that exact file. Microsoft does not take a standing allow-list from developers. Sending the same signed files over time helps later reviews, because the certificate identifies the publisher.

1. Open https://www.microsoft.com/en-us/wdsi/filesubmission and sign in.
2. Submit as Software developer.
3. Upload the file Defender flagged. Send the signed `Meldmind-Setup-<version>.exe` when the installer is flagged, and `Meldmind.exe` from an installed copy when the app itself is flagged. Submit the file you shipped, not a different build.
4. Describe it as a false positive. Include the product name Meldmind, the publisher Everborn Productions, the version, and the detection name Defender showed.
5. Wait until the submission has a final determination. You can track it while you are signed in.
6. If you disagree with that determination, use the developer contact form on the submission result. Do not start over with a new file until you have read the result.

Do not email the file. The submission portal is the path Microsoft accepts. Do not upload customer data, a key, or anything from `data\`.

If you have Microsoft Defender for Endpoint, an admin can also submit from the Defender portal: Investigation & response, Actions & submissions, Submissions, Files, Add new submission, category Clean (false positive). The public software-developer form above is the one to use when you do not have that subscription.
