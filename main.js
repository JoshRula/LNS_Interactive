/*
  Parent-page navigation controller for the iframe-based kiosk.

  Architecture:
  - index.html owns the modal overlay, iframe, Back button, and navigation history.
  - Each content page lives in its own folder and is loaded into the iframe.
  - Each content page owns its background PNG and page-specific hotspots.
  - A child page opens another page by calling:

      window.parent.navigateContentPage("content/example/index.html");

  This project intentionally avoids fetch(), ES modules, frameworks, and external
  dependencies so it can run locally in Fully Kiosk Browser.
*/

document.addEventListener("DOMContentLoaded", initializeKioskNavigation);

/* =========================================================
   DOM REFERENCES
   ========================================================= */

const modalOverlay = document.getElementById("modalOverlay");
const contentFrame = document.getElementById("content");
const modalBackButton = document.getElementById("modalBackButton");

const mainMenuHotspots = document.querySelectorAll(
  ".main-menu-hotspot[data-content-page]"
);

/* =========================================================
   NAVIGATION STATE
   ========================================================= */

/*
  Each entry is a relative path previously displayed in the iframe.

  Example:
  [
    "content/products/index.html",
    "content/products/bar-feeders/index.html"
  ]
*/
let contentNavigationHistory = [];

/* The page currently displayed in the iframe. */
let currentContentPagePath = null;

/* The first page used when the modal was opened. */
let modalStartingPagePath = null;

/* =========================================================
   INITIALIZATION
   ========================================================= */

function initializeKioskNavigation() {
  if (!validateRequiredParentElements()) {
    return;
  }

  initializeMainMenuListeners();
  initializeModalListeners();
  resetIframeToBlankPage();
  updateBackButtonVisibility();
}

/*
  Stop initialization early if the revised index.html is not in place.
  This gives a useful console message rather than causing later null errors.
*/
function validateRequiredParentElements() {
  const missingElementIds = [];

  if (!modalOverlay) {
    missingElementIds.push("modalOverlay");
  }

  if (!contentFrame) {
    missingElementIds.push("content");
  }

  if (!modalBackButton) {
    missingElementIds.push("modalBackButton");
  }

  if (missingElementIds.length > 0) {
    console.error(
      `Kiosk navigation could not initialize. Missing element(s): ${missingElementIds.join(", ")}`
    );
    return false;
  }

  return true;
}

/* =========================================================
   MAIN-MENU EVENT LISTENERS
   ========================================================= */

function initializeMainMenuListeners() {
  if (mainMenuHotspots.length === 0) {
    console.warn(
      "No main-menu hotspots were found with a data-content-page attribute."
    );
    return;
  }

  mainMenuHotspots.forEach((hotspotButton) => {
    hotspotButton.addEventListener("click", () => {
      const startingPagePath = hotspotButton.dataset.contentPage;

      if (!isValidContentPath(startingPagePath)) {
        console.error(
          `Main-menu hotspot "${hotspotButton.id}" does not have a valid data-content-page path.`
        );
        return;
      }

      openKioskModal(startingPagePath);
    });
  });
}

/* =========================================================
   MODAL EVENT LISTENERS
   ========================================================= */

function initializeModalListeners() {
  modalBackButton.addEventListener("click", (event) => {
    /*
      Prevent the Back-button click from bubbling to the overlay and being
      mistaken for an outside click.
    */
    event.stopPropagation();
    navigateBackOnePage();
  });

  modalOverlay.addEventListener("click", (event) => {
    /*
      Close only when the dark overlay itself is clicked.

      Clicks inside the iframe do not bubble into the parent document.
      The explicit target check also protects the parent Back button.
    */
    if (event.target === modalOverlay) {
      closeAndResetKioskModal();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !modalOverlay.classList.contains("hidden")
    ) {
      closeAndResetKioskModal();
    }
  });

  /*
    Useful during development: the load event confirms that the iframe
    navigated. Fully Kiosk Browser may not provide a reliable parent-level
    error event for a missing local HTML file, so missing paths should also
    be checked through the browser console during setup.
  */
  contentFrame.addEventListener("load", () => {
    console.info(
      `Kiosk iframe loaded: ${currentContentPagePath || contentFrame.src}`
    );
  });
}

/* =========================================================
   OPENING AND CLOSING THE MODAL
   ========================================================= */

function openKioskModal(startingPagePath) {
  if (!isValidContentPath(startingPagePath)) {
    console.error(`Cannot open invalid kiosk page path: ${startingPagePath}`);
    return;
  }

  /*
    Every main-menu selection starts a completely new navigation session.
    This prevents a previous user's drill-down history from being reused.
  */
  contentNavigationHistory = [];
  currentContentPagePath = null;
  modalStartingPagePath = startingPagePath;

  loadContentPage(startingPagePath);

  modalOverlay.classList.remove("hidden");
  modalOverlay.setAttribute("aria-hidden", "false");

  updateBackButtonVisibility();
}

function closeAndResetKioskModal() {
  modalOverlay.classList.add("hidden");
  modalOverlay.setAttribute("aria-hidden", "true");

  contentNavigationHistory = [];
  currentContentPagePath = null;
  modalStartingPagePath = null;

  /*
    Clearing the iframe prevents the last content page from briefly appearing
    the next time the modal is opened.
  */
  resetIframeToBlankPage();
  updateBackButtonVisibility();
}

/* =========================================================
   FORWARD NAVIGATION
   ========================================================= */

/*
  This is the public navigation function used by child iframe pages.

  Example child-page hotspot:
    window.parent.navigateContentPage(
      "content/products/bar-feeders/index.html"
    );

  The supplied path should be relative to the root index.html, not relative
  to the child page that is currently loaded.
*/
function navigateContentPage(destinationPagePath) {
  if (!isValidContentPath(destinationPagePath)) {
    console.error(
      `Cannot navigate to invalid kiosk page path: ${destinationPagePath}`
    );
    return;
  }

  if (currentContentPagePath) {
    contentNavigationHistory.push(currentContentPagePath);
  }

  loadContentPage(destinationPagePath);
  updateBackButtonVisibility();
}

/*
  Expose the parent navigation function so same-origin iframe pages can call
  window.parent.navigateContentPage(...).

  This should be tested once in Fully Kiosk Browser before building the full
  page tree because Android WebView settings can affect local file access.
*/
window.navigateContentPage = navigateContentPage;

/* =========================================================
   BACK NAVIGATION
   ========================================================= */

function navigateBackOnePage() {
  if (contentNavigationHistory.length === 0) {
    updateBackButtonVisibility();
    return;
  }

  const previousPagePath = contentNavigationHistory.pop();

  /*
    Back navigation loads the prior page directly and does not push the
    current page into history again.
  */
  loadContentPage(previousPagePath);
  updateBackButtonVisibility();
}

function updateBackButtonVisibility() {
  const shouldHideBackButton = contentNavigationHistory.length === 0;

  modalBackButton.classList.toggle("hidden", shouldHideBackButton);
  modalBackButton.disabled = shouldHideBackButton;
  modalBackButton.setAttribute(
    "aria-hidden",
    String(shouldHideBackButton)
  );
}

/* =========================================================
   IFRAME PAGE LOADING
   ========================================================= */

function loadContentPage(pagePath) {
  if (!isValidContentPath(pagePath)) {
    console.error(`Refusing to load invalid kiosk page path: ${pagePath}`);
    return;
  }

  currentContentPagePath = pagePath;

  /*
    Assigning src is used instead of fetch() so the project remains compatible
    with a local file-based kiosk deployment.
  */
  contentFrame.src = pagePath;
}

function resetIframeToBlankPage() {
  contentFrame.src = "about:blank";
}

/* =========================================================
   PATH VALIDATION
   ========================================================= */

function isValidContentPath(pagePath) {
  return (
    typeof pagePath === "string" &&
    pagePath.trim().length > 0 &&
    pagePath !== "about:blank"
  );
}