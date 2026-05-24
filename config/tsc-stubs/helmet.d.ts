// Ambient stub for helmet — Express security middleware.
// Helmet ships its own types but isn't installed in the release toolchain.
declare module 'helmet' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const helmet: any;
  export default helmet;
}
