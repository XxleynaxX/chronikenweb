/**
 * Chroniken – Rechtlicher Hinweis (Modal)
 * © 2026 Kiyasha
 */
(function () {
  const LEGAL_HTML = `
    <div class="legal-modal-overlay" id="legalNoticeOverlay" role="dialog" aria-modal="true" aria-labelledby="legalNoticeTitle">
      <div class="legal-modal">
        <button type="button" class="legal-close" id="legalNoticeClose" aria-label="Schließen">×</button>
        <h2 id="legalNoticeTitle">Rechtlicher Hinweis</h2>
        <p><strong>Informationen gemäß § 5 DDG / § 18 MStV:</strong></p>
        <p>Diese Website ist ein rein privates, nicht-kommerzielles Freizeit- und Rollenspiel-Projekt (Gaming/RPG-Wiki). Die Inhalte dienen ausschließlich persönlichen und gemeinschaftlichen Unterhaltungszwecken innerhalb der Spielgemeinschaft.</p>
        <p>Es werden keine gewerblichen Interessen verfolgt, keine Waren oder Dienstleistungen gegen Entgelt angeboten und keine Werbeeinnahmen oder sonstigen finanziellen Zuwendungen generiert.</p>
        <p>Aus diesem Grund besteht für dieses Onlineangebot keine gesetzliche Impressumspflicht im Sinne des § 5 des Digitale-Dienste-Gesetzes (DDG) sowie des § 18 des Medienstaatsvertrages (MStV).</p>
      </div>
    </div>
  `;

  function ensureModal() {
    if (document.getElementById("legalNoticeOverlay")) return;
    document.body.insertAdjacentHTML("beforeend", LEGAL_HTML);

    const overlay = document.getElementById("legalNoticeOverlay");
    const closeBtn = document.getElementById("legalNoticeClose");

    closeBtn.addEventListener("click", closeLegalNotice);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeLegalNotice();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("open")) {
        closeLegalNotice();
      }
    });
  }

  window.openLegalNotice = function () {
    ensureModal();
    const overlay = document.getElementById("legalNoticeOverlay");
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
  };

  window.closeLegalNotice = function () {
    const overlay = document.getElementById("legalNoticeOverlay");
    if (overlay) {
      overlay.classList.remove("open");
      document.body.style.overflow = "";
    }
  };

  // Auto-init if DOM already ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureModal);
  } else {
    ensureModal();
  }
})();
