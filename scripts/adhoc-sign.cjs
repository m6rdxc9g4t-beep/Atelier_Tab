/**
 * Hook electron-builder (afterPack) : signature « ad hoc » de l'application.
 *
 * Sans compte développeur Apple, l'app n'est pas signée par un certificat. Or les Mac
 * à puce Apple refusent de lancer un exécutable sans aucune signature : une signature
 * locale (identité « - ») suffit pour une app construite et utilisée sur la même machine.
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • signature ad hoc  ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
