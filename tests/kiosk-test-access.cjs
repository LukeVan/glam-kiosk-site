module.exports = async function grantTestAccess(page) {
  await page.evaluate(async () => {
    const { ACCESS_VERIFIER } = await import('/blocks/attendee-kiosk/access-gate.js');
    sessionStorage.setItem('glam-kiosk-access-v1', ACCESS_VERIFIER);
  });
};
