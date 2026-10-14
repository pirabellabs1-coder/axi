/** Squelette de la page de téléchargement : en-tête, liste des fichiers. */
export default function DownloadLoading() {
  const block = "animate-pulse-soft rounded-[20px] bg-white ring-1 ring-black/5";
  return (
    <div data-theme="light" className="min-h-dvh bg-[#f6f6f3]" aria-busy="true" aria-label="Chargement de vos fichiers">
      <div className="h-16 border-b border-black/5 bg-white" />
      <div className="container-x max-w-[720px] pt-8">
        <div className="h-4 w-40 animate-pulse-soft rounded-full bg-black/5" />
        <div className="mt-3 h-9 w-52 animate-pulse-soft rounded-full bg-black/5" />
        <div className={`${block} mt-6 h-56`} />
        <div className={`${block} mt-4 h-24`} />
      </div>
    </div>
  );
}
