/*
  Parent-page navigation and session coaching controller.

  The parent page owns:
  - iframe navigation history
  - Back and outside-to-close behavior
  - inactivity coaching
  - abandonment/farewell behavior
  - per-user familiarity counters

  Child iframe pages continue to navigate by calling:

    window.parent.navigateContentPage("content/example/index.html");
*/

document.addEventListener("DOMContentLoaded", () => {
  initializeRotatedViewport();
  initializeKioskNavigation();
});


/* =========================================================
   ROTATED PORTRAIT VIEWPORT
   ========================================================= */

/*
  The kiosk is authored as a fixed 1080 x 1920 portrait canvas, while Android
  and Fully Kiosk remain in landscape. CSS rotates the canvas. This function
  scales it to fit the actual browser viewport without changing any existing
  page coordinates.

  After a 90-degree rotation, the portrait canvas occupies:
    1920 logical pixels of browser width
    1080 logical pixels of browser height
*/
function initializeRotatedViewport() {
  const rotationViewport = document.getElementById("rotationViewport");

  if (!rotationViewport) {
    console.error("Rotated viewport could not initialize. Missing element: rotationViewport");
    return;
  }

  const updateRotatedViewportScale = () => {
    const availableWidth = window.innerWidth;
    const availableHeight = window.innerHeight;

    const widthScale = availableWidth / 1920;
    const heightScale = availableHeight / 1080;
    const fittedScale = Math.min(widthScale, heightScale);

    rotationViewport.style.setProperty(
      "--kiosk-scale",
      String(fittedScale)
    );
  };

  updateRotatedViewportScale();
  window.addEventListener("resize", updateRotatedViewportScale);
  window.addEventListener("orientationchange", updateRotatedViewportScale);
}

/* =========================================================
   CONFIGURATION
   ========================================================= */

const coachingSettings = {
  initialBackTipDelay: 3000,
  outsideTipAdditionalDelay: 1000,
  coachingDelayMultiplier: 2,
  maximumBackTipDelay: 24000,

  initialAbandonmentDelay: 25000,
  abandonmentDelayMultiplier: 1.4,
  maximumAbandonmentDelay: 70000,

  farewellDisplayDuration: 3000,
  homeIdleNewUserDelay: 7000,
  maximumFamiliarityLevel: 3,
  deepNavigationThreshold: 3
};

/* =========================================================
   DOM REFERENCES
   ========================================================= */

const modalOverlay = document.getElementById("modalOverlay");
const contentFrame = document.getElementById("content");
const modalBackButton = document.getElementById("modalBackButton");
const backButtonTip = document.getElementById("backButtonTip");
const outsideTapTip = document.getElementById("outsideTapTip");
const farewellTip = document.getElementById("farewellTip");

const mainMenuHotspots = document.querySelectorAll(
  ".main-menu-hotspot[data-content-page]"
);

/* =========================================================
   NAVIGATION AND SESSION STATE
   ========================================================= */

let contentNavigationHistory = [];
let currentContentPagePath = null;
let modalStartingPagePath = null;

const kioskSession = {
  sessionId: 1,
  familiarityLevel: 0,

  backActions: 0,
  outsideCloseActions: 0,
  forwardNavigations: 0,
  deepNavigationActions: 0,
  deepestNavigationLevel: 0,

  backTipDisplays: 0,
  outsideTipDisplays: 0,
  abandonmentCount: 0,

  deepNavigationCreditGranted: false,
  lastActivityTime: Date.now(),

  backTipTimerId: null,
  outsideTipTimerId: null,
  abandonmentTimerId: null,
  farewellTimerId: null,
  homeIdleTimerId: null,
  farewellIsActive: false
};

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
  scheduleHomeIdleNewUserReset();
}

function validateRequiredParentElements() {
  const requiredElements = {
    modalOverlay,
    content: contentFrame,
    modalBackButton,
    backButtonTip,
    outsideTapTip,
    farewellTip
  };

  const missingElementIds = Object.entries(requiredElements)
    .filter(([, element]) => !element)
    .map(([elementId]) => elementId);

  if (missingElementIds.length > 0) {
    console.error(
      `Kiosk navigation could not initialize. Missing element(s): ${missingElementIds.join(", ")}`
    );
    return false;
  }

  return true;
}

/* =========================================================
   MAIN-MENU LISTENERS
   ========================================================= */

function initializeMainMenuListeners() {
  if (mainMenuHotspots.length === 0) {
    console.warn(
      "No main-menu hotspots were found with a data-content-page attribute."
    );
    return;
  }

  mainMenuHotspots.forEach((hotspotButton) => {
    hotspotButton.addEventListener("pointerdown", () => {
      cancelHomeIdleNewUserReset();
    });

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
   MODAL AND IFRAME LISTENERS
   ========================================================= */

function initializeModalListeners() {
  modalBackButton.addEventListener("click", (event) => {
    event.stopPropagation();
    registerLearnedInteraction("back");
    navigateBackOnePage();
  });

  modalOverlay.addEventListener("pointerdown", (event) => {
    if (event.target === modalOverlay) {
      registerLearnedInteraction("outside-close");
      closeAndResetKioskModal({ scheduleHomeReset: true });
    }
  });

  window.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !modalOverlay.classList.contains("hidden")
    ) {
      closeAndResetKioskModal({ scheduleHomeReset: true });
    }
  });

  contentFrame.addEventListener("load", () => {
    attachIframeActivityListeners();

    if (!modalOverlay.classList.contains("hidden")) {
      restartInactivitySequence();
    }

    console.info(
      `Kiosk iframe loaded: ${currentContentPagePath || contentFrame.src}`
    );
  });
}

function attachIframeActivityListeners() {
  try {
    const iframeDocument = contentFrame.contentDocument;

    if (!iframeDocument || iframeDocument.__kioskActivityListenerAttached) {
      return;
    }

    iframeDocument.__kioskActivityListenerAttached = true;

    iframeDocument.addEventListener(
      "pointerdown",
      () => registerKioskActivity("content-touch"),
      { passive: true }
    );

    iframeDocument.addEventListener(
      "keydown",
      () => registerKioskActivity("content-keyboard"),
      { passive: true }
    );
  } catch (error) {
    console.warn(
      "Unable to attach iframe activity tracking. Serve the kiosk through the local HTTP server so the parent and iframe share one origin.",
      error
    );
  }
}

/* =========================================================
   OPENING, CLOSING, AND NEW-USER RESET
   ========================================================= */

function openKioskModal(startingPagePath) {
  if (!isValidContentPath(startingPagePath)) {
    console.error(`Cannot open invalid kiosk page path: ${startingPagePath}`);
    return;
  }

  cancelHomeIdleNewUserReset();
  cancelFarewellSequence();

  contentNavigationHistory = [];
  currentContentPagePath = null;
  modalStartingPagePath = startingPagePath;

  modalOverlay.classList.remove("hidden");
  modalOverlay.setAttribute("aria-hidden", "false");

  loadContentPage(startingPagePath);
  updateBackButtonVisibility();
  registerKioskActivity("modal-open");
}

function closeAndResetKioskModal({ scheduleHomeReset = true } = {}) {
  clearInactivityTimers();
  cancelFarewellSequence();
  hideAllCoachingTips();

  modalOverlay.classList.add("hidden");
  modalOverlay.setAttribute("aria-hidden", "true");

  contentNavigationHistory = [];
  currentContentPagePath = null;
  modalStartingPagePath = null;

  resetIframeToBlankPage();
  updateBackButtonVisibility();

  if (scheduleHomeReset) {
    scheduleHomeIdleNewUserReset();
  }
}

function scheduleHomeIdleNewUserReset() {
  cancelHomeIdleNewUserReset();

  kioskSession.homeIdleTimerId = window.setTimeout(() => {
    beginNewUserSession();
  }, coachingSettings.homeIdleNewUserDelay);
}

function cancelHomeIdleNewUserReset() {
  if (kioskSession.homeIdleTimerId !== null) {
    window.clearTimeout(kioskSession.homeIdleTimerId);
    kioskSession.homeIdleTimerId = null;
  }
}

function beginNewUserSession() {
  clearAllSessionTimers();
  hideAllCoachingTips();

  kioskSession.sessionId += 1;
  kioskSession.familiarityLevel = 0;

  kioskSession.backActions = 0;
  kioskSession.outsideCloseActions = 0;
  kioskSession.forwardNavigations = 0;
  kioskSession.deepNavigationActions = 0;
  kioskSession.deepestNavigationLevel = 0;

  kioskSession.backTipDisplays = 0;
  kioskSession.outsideTipDisplays = 0;
  kioskSession.deepNavigationCreditGranted = false;
  kioskSession.lastActivityTime = Date.now();
  kioskSession.farewellIsActive = false;

  console.info(`Started kiosk user session ${kioskSession.sessionId}.`);
}

/* =========================================================
   FORWARD AND BACK NAVIGATION
   ========================================================= */

function navigateContentPage(destinationPagePath) {
  if (!isValidContentPath(destinationPagePath)) {
    console.error(
      `Cannot navigate to invalid kiosk page path: ${destinationPagePath}`
    );
    return;
  }

  registerKioskActivity("forward-navigation");

  if (currentContentPagePath) {
    contentNavigationHistory.push(currentContentPagePath);
  }

  kioskSession.forwardNavigations += 1;
  updateNavigationDepthMetrics();

  loadContentPage(destinationPagePath);
  updateBackButtonVisibility();
}

window.navigateContentPage = navigateContentPage;

function navigateBackOnePage() {
  if (contentNavigationHistory.length === 0) {
    updateBackButtonVisibility();
    return;
  }

  const previousPagePath = contentNavigationHistory.pop();
  loadContentPage(previousPagePath);
  updateBackButtonVisibility();
  restartInactivitySequence();
}

function updateBackButtonVisibility() {
  const shouldHideBackButton = contentNavigationHistory.length === 0;

  modalBackButton.classList.toggle("hidden", shouldHideBackButton);
  modalBackButton.disabled = shouldHideBackButton;
  modalBackButton.setAttribute("aria-hidden", String(shouldHideBackButton));

  if (shouldHideBackButton) {
    backButtonTip.classList.remove("is-visible");
    modalBackButton.classList.remove("coaching-highlight");
  }
}

function updateNavigationDepthMetrics() {
  const currentDepth = contentNavigationHistory.length + 1;

  kioskSession.deepestNavigationLevel = Math.max(
    kioskSession.deepestNavigationLevel,
    currentDepth
  );

  if (
    currentDepth >= coachingSettings.deepNavigationThreshold &&
    !kioskSession.deepNavigationCreditGranted
  ) {
    kioskSession.deepNavigationCreditGranted = true;
    kioskSession.deepNavigationActions += 1;
    increaseFamiliarityLevel();
  }
}

/* =========================================================
   FAMILIARITY AND ACTION COUNTERS
   ========================================================= */

function registerLearnedInteraction(interactionType) {
  if (interactionType === "back") {
    kioskSession.backActions += 1;
  }

  if (interactionType === "outside-close") {
    kioskSession.outsideCloseActions += 1;
  }

  increaseFamiliarityLevel();
}

function increaseFamiliarityLevel() {
  kioskSession.familiarityLevel = Math.min(
    kioskSession.familiarityLevel + 1,
    coachingSettings.maximumFamiliarityLevel
  );
}

/* =========================================================
   INACTIVITY COACHING
   ========================================================= */

function registerKioskActivity(activityType) {
  kioskSession.lastActivityTime = Date.now();

  if (kioskSession.farewellIsActive) {
    cancelFarewellSequence();
  }

  hideAllCoachingTips();
  clearInactivityTimers();

  if (!modalOverlay.classList.contains("hidden")) {
    restartInactivitySequence();
  }

  console.debug(`Kiosk activity: ${activityType}`);
}

function restartInactivitySequence() {
  clearInactivityTimers();
  hideAllCoachingTips();

  if (modalOverlay.classList.contains("hidden")) {
    return;
  }

  const backTipDelay = getBackTipDelay();
  const backIsAvailable = contentNavigationHistory.length > 0;
  const outsideTipDelay = backIsAvailable
    ? backTipDelay + coachingSettings.outsideTipAdditionalDelay
    : backTipDelay;

  if (backIsAvailable) {
    kioskSession.backTipTimerId = window.setTimeout(
      showBackInstruction,
      backTipDelay
    );
  }

  kioskSession.outsideTipTimerId = window.setTimeout(
    showOutsideTapInstruction,
    outsideTipDelay
  );

  kioskSession.abandonmentTimerId = window.setTimeout(
    beginAbandonmentSequence,
    getAbandonmentDelay()
  );
}

function getBackTipDelay() {
  return Math.min(
    coachingSettings.initialBackTipDelay *
      Math.pow(
        coachingSettings.coachingDelayMultiplier,
        kioskSession.familiarityLevel
      ),
    coachingSettings.maximumBackTipDelay
  );
}

function getAbandonmentDelay() {
  return Math.min(
    coachingSettings.initialAbandonmentDelay *
      Math.pow(
        coachingSettings.abandonmentDelayMultiplier,
        kioskSession.familiarityLevel
      ),
    coachingSettings.maximumAbandonmentDelay
  );
}

function showBackInstruction() {
  if (
    modalOverlay.classList.contains("hidden") ||
    contentNavigationHistory.length === 0
  ) {
    return;
  }

  kioskSession.backTipDisplays += 1;
  modalBackButton.classList.add("coaching-highlight");
  backButtonTip.classList.add("is-visible");
}

function showOutsideTapInstruction() {
  if (modalOverlay.classList.contains("hidden")) {
    return;
  }

  kioskSession.outsideTipDisplays += 1;
  outsideTapTip.classList.add("is-visible");
}

function hideAllCoachingTips() {
  backButtonTip.classList.remove("is-visible");
  outsideTapTip.classList.remove("is-visible");
  farewellTip.classList.remove("is-visible");
  modalBackButton.classList.remove("coaching-highlight");
}

function clearInactivityTimers() {
  const timerKeys = [
    "backTipTimerId",
    "outsideTipTimerId",
    "abandonmentTimerId"
  ];

  timerKeys.forEach((timerKey) => {
    if (kioskSession[timerKey] !== null) {
      window.clearTimeout(kioskSession[timerKey]);
      kioskSession[timerKey] = null;
    }
  });
}

/* =========================================================
   ABANDONMENT AND FAREWELL
   ========================================================= */

function beginAbandonmentSequence() {
  clearInactivityTimers();
  hideAllCoachingTips();

  kioskSession.abandonmentCount += 1;
  kioskSession.farewellIsActive = true;
  farewellTip.classList.add("is-visible");

  kioskSession.farewellTimerId = window.setTimeout(() => {
    kioskSession.farewellTimerId = null;
    kioskSession.farewellIsActive = false;

    closeAndResetKioskModal({ scheduleHomeReset: false });
    beginNewUserSession();
  }, coachingSettings.farewellDisplayDuration);
}

function cancelFarewellSequence() {
  if (kioskSession.farewellTimerId !== null) {
    window.clearTimeout(kioskSession.farewellTimerId);
    kioskSession.farewellTimerId = null;
  }

  kioskSession.farewellIsActive = false;
  farewellTip.classList.remove("is-visible");
}

function clearAllSessionTimers() {
  clearInactivityTimers();
  cancelFarewellSequence();
  cancelHomeIdleNewUserReset();
}

/* =========================================================
   IFRAME PAGE LOADING AND PATH VALIDATION
   ========================================================= */

function loadContentPage(pagePath) {
  if (!isValidContentPath(pagePath)) {
    console.error(`Refusing to load invalid kiosk page path: ${pagePath}`);
    return;
  }

  currentContentPagePath = pagePath;
  contentFrame.src = pagePath;
}

function resetIframeToBlankPage() {
  contentFrame.src = "about:blank";
}

function isValidContentPath(pagePath) {
  return (
    typeof pagePath === "string" &&
    pagePath.trim().length > 0 &&
    pagePath !== "about:blank"
  );
}
