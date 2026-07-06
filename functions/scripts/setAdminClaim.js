const admin = require('firebase-admin');

const {
  createAdminClaims,
  normalizeAdminLookup,
  parseAdminClaimArgs,
} = require('../adminClaimsCore');

function printUsage() {
  console.log('Usage: npm --prefix functions run admin:claim -- --grant --uid <uid>');
  console.log('   or: npm --prefix functions run admin:claim -- --grant --email <email>');
  console.log('   or: npm --prefix functions run admin:claim -- --revoke --uid <uid>');
}

async function resolveUser(auth, lookup) {
  if (lookup.kind === 'uid') {
    return auth.getUser(lookup.value);
  }

  return auth.getUserByEmail(lookup.value);
}

async function main() {
  const parsedArgs = parseAdminClaimArgs(process.argv.slice(2));

  if (!parsedArgs.ok) {
    printUsage();
    throw new Error(parsedArgs.error);
  }

  const options = parsedArgs.value;
  const lookup = normalizeAdminLookup(options);

  if (!lookup.ok) {
    printUsage();
    throw new Error(lookup.error);
  }

  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const auth = admin.auth();
  const user = await resolveUser(auth, lookup.value);
  const nextClaims = createAdminClaims(user.customClaims, options.mode === 'grant');

  await auth.setCustomUserClaims(user.uid, nextClaims);

  console.log(`${options.mode === 'grant' ? 'Granted' : 'Revoked'} admin claim for ${user.uid}.`);
  console.log('The user must refresh their ID token or sign in again before the claim is visible.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
