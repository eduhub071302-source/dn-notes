import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  initializeFirestore, // NEW
  persistentLocalCache, // NEW
  persistentMultipleTabManager, // NEW
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  serverTimestamp,
  deleteDoc,
  doc,
  updateDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

import {
  getMessaging,
  getToken,
  onMessage,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyDrIpkCiUtGJMoIso8MIfo1YoFSH3FCH7A",
  authDomain: "dn-notes-73371.firebaseapp.com",
  projectId: "dn-notes-73371",
  storageBucket: "dn-notes-73371.firebasestorage.app",
  messagingSenderId: "915761462285",
  appId: "1:915761462285:web:8ffbbd34422f0da26c6944",
};

const app = initializeApp(firebaseConfig);

// NEW: Enable offline local storage using the modern v10 method.
// This forces the app to load from device storage first, drastically reducing Firestore reads!
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// Request Notification Permission on load
if (
  "Notification" in window &&
  Notification.permission !== "granted" &&
  Notification.permission !== "denied"
) {
  Notification.requestPermission().then((permission) => {
    if (permission === "granted") {
      console.log("OS Notifications enabled!");
    }
  });
}

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let currentUser = null;
let activeCategory = "daily-habits";
let selectedDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
let unsubscribeNotes = null;
let activeModalNoteId = null; // Tracks the currently opened note ID for Delete/Done ops
let alarmNotes = [];
let unsubscribeAlarms = null;
let triggeredAlarms = new Set();
let alarmInterval = null;

// Auth UI bindings
const authForms = document.getElementById("auth-forms");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userProfileView = document.getElementById("user-profile");
const userAvatar = document.getElementById("user-avatar");
const userNameText = document.getElementById("user-name");
const emailInput = document.getElementById("email-input");
const passwordInput = document.getElementById("password-input");
const confirmPasswordInput = document.getElementById("confirm-password-input");
const emailActionBtn = document.getElementById("email-action-btn");
const toggleAuthModeBtn = document.getElementById("toggle-auth-mode-btn");

let isSignUpMode = false;

toggleAuthModeBtn.addEventListener("click", () => {
  isSignUpMode = !isSignUpMode;
  if (isSignUpMode) {
    confirmPasswordInput.classList.remove("hidden");
    emailActionBtn.innerText = "Sign Up";
    toggleAuthModeBtn.innerText = "Already have an account? Sign In";
  } else {
    confirmPasswordInput.classList.add("hidden");
    emailActionBtn.innerText = "Sign In";
    toggleAuthModeBtn.innerText = "Need an account? Sign Up";
  }
});

emailActionBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!email || !password)
    return alert("Please enter both email and password.");

  try {
    if (isSignUpMode) {
      if (password !== confirmPassword) return alert("Passwords do not match!");
      if (password.length < 6)
        return alert("Password must be at least 6 characters.");
      await createUserWithEmailAndPassword(auth, email, password);
      emailInput.value = "";
      passwordInput.value = "";
      confirmPasswordInput.value = "";
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    alert(`Authentication Error: ${err.message}`);
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    authForms.classList.add("hidden");
    userProfileView.classList.remove("hidden");
    userAvatar.src =
      user.photoURL ||
      `https://ui-avatars.com/api/?name=${user.email}&background=00e5ff&color=0b0f19`;
    userNameText.innerText = user.displayName
      ? user.displayName.split(" ")[0]
      : user.email.split("@")[0];

    streamUserNotes();
    startAlarmEngine(); // NEW: Start the global alarm checker
  } else {
    currentUser = null;
    userProfileView.classList.add("hidden");
    authForms.classList.remove("hidden");
    document.getElementById("notes-grid").innerHTML =
      '<p style="padding:15px; color:#64748b;">Please login to load your cloud synced notes.</p>';

    if (unsubscribeNotes) unsubscribeNotes();

    // NEW: Shut down alarms on logout
    if (unsubscribeAlarms) unsubscribeAlarms();
    if (alarmInterval) clearInterval(alarmInterval);
  }

  // Initialize Messaging
  const messaging = getMessaging(app);

  // Replace this with the key you copied in Step 1!
  const VAPID_KEY =
    "BPKM5Z8YirkyB4OORXKQiRL2ukLjivdyydm9pzVFcEmkGmnJ8of_y4HxYB6DtmEKxBbp4ao2s2M0IpHkCFcNNjQ";

  async function requestPushPermissions() {
    try {
      console.log("Requesting notification permission...");
      const permission = await Notification.requestPermission();

      if (permission === "granted") {
        console.log("Notification permission granted.");

        // Inside your requestPushPermissions() function...

        // 1. Register the service worker with an explicit GitHub Pages path and scope
        const swRegistration = await navigator.serviceWorker.register(
          "/dn-notes/firebase-messaging-sw.js",
          { scope: "/dn-notes/" },
        );

        await navigator.serviceWorker.ready;

        // 2. Pass the registration directly into the getToken function
        const currentToken = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: swRegistration,
        });

        if (currentToken) {
          console.log("SUCCESS! Your Device Token is:", currentToken);
          const userRef = doc(db, "users", currentUser.uid);
          await setDoc(userRef, { fcmToken: currentToken }, { merge: true });
        } else {
          console.log(
            "No registration token available. Request permission to generate one.",
          );
        }
      } else {
        console.log("Do not have permission to send notifications.");
      }
    } catch (err) {
      console.error("An error occurred while retrieving token.", err);
    }
  }

  // Call it immediately after logging in so it saves to the database
  requestPushPermissions();

  // Handle messages when the app is currently open on the screen
  onMessage(messaging, (payload) => {
    console.log("Message received while app is open: ", payload);

    if ("Notification" in window && Notification.permission === "granted") {
      const title = payload.notification.title || "DN Notes Alarm";
      const options = {
        body:
          payload.notification.body ||
          "It is time! Open the app to view your task.",
        icon: "icons/icon-192.png",
        vibrate: [300, 100, 300, 100, 300],
        requireInteraction: true,
      };

      // Universally forces the Service Worker to handle the display
      navigator.serviceWorker.ready.then((registration) => {
        registration.showNotification(title, options);
      });
    }
  });
});

loginBtn.addEventListener("click", () => {
  signInWithPopup(auth, provider).catch((err) =>
    alert(`Google Sign-In Failed: ${err.message}`),
  );
});
logoutBtn.addEventListener("click", () => signOut(auth));

/* --- Structural UI Bindings --- */
const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("toggle-btn");
const editor = document.getElementById("editor");
const topicInput = document.getElementById("note-topic");
const saveBtn = document.getElementById("save-note-btn");
const notesGrid = document.getElementById("notes-grid");

// Multi-Time UI Logic
const addTimeBtn = document.getElementById("add-time-btn");
const timePickersContainer = document.getElementById("time-pickers-container");

addTimeBtn.addEventListener("click", () => {
  const currentPickers = timePickersContainer.querySelectorAll(
    ".reminder-time-input",
  ).length;
  if (currentPickers >= 5)
    return alert("You can set a maximum of 5 reminder times.");

  const wrapper = document.createElement("div");
  wrapper.className = "time-picker-wrapper";
  wrapper.innerHTML = `
    <input type="time" class="reminder-time-input" value="08:00" />
    <button class="remove-time-btn" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold;">X</button>
  `;
  timePickersContainer.appendChild(wrapper);
});

timePickersContainer.addEventListener("click", (e) => {
  if (e.target.classList.contains("remove-time-btn")) {
    e.target.parentElement.remove();
  }
});

// Scheduling Toggles
const durationSelect = document.getElementById("habit-duration-type");
const rangeInputsWrap = document.getElementById("date-range-inputs");
const singleDateWrap = document.getElementById("single-date-input");
const dayButtons = document.querySelectorAll(".day-dot");

durationSelect.addEventListener("change", (e) => {
  rangeInputsWrap.classList.add("hidden");
  singleDateWrap.classList.add("hidden");

  if (e.target.value === "range") rangeInputsWrap.classList.remove("hidden");
  if (e.target.value === "specific-date")
    singleDateWrap.classList.remove("hidden");
});

dayButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const day = btn.dataset.day;
    if (selectedDays.includes(day)) {
      selectedDays = selectedDays.filter((d) => d !== day);
      btn.classList.remove("active");
    } else {
      selectedDays.push(day);
      btn.classList.add("active");
    }
  });
});

/* --- Category Management Engine --- */
document.querySelectorAll("#sidebar li").forEach((item) => {
  item.addEventListener("click", (e) => {
    document
      .querySelectorAll("#sidebar li")
      .forEach((li) => li.classList.remove("active"));
    item.classList.add("active");
    activeCategory = item.dataset.category;
    document.getElementById("active-view-category").innerText = item.innerText;
    manageSchedulingUI();
    streamUserNotes();
  });
});

function manageSchedulingUI() {
  const specialDaysBar = document.getElementById("special-days-options");
  const durationSelectWrapper = document.getElementById(
    "duration-select-wrapper",
  );
  const birthdayDateWrapper = document.getElementById("birthday-date-wrapper");
  const daysSelector = document.getElementById("days-selector");

  // Reset generic views
  specialDaysBar.classList.add("hidden");
  durationSelectWrapper.classList.remove("hidden");
  birthdayDateWrapper.classList.add("hidden");
  daysSelector.classList.remove("hidden");

  if (activeCategory === "birthdays") {
    durationSelectWrapper.classList.add("hidden");
    daysSelector.classList.add("hidden");
    birthdayDateWrapper.classList.remove("hidden");
  } else if (activeCategory === "special-days") {
    specialDaysBar.classList.remove("hidden");
    durationSelectWrapper.classList.add("hidden");
    daysSelector.classList.add("hidden");
  }
}

/* --- Sri Lankan Holidays API --- */
const CALENDARIFIC_API_KEY = "sbPplbaZdE6zrjhRItLSikyOycPAHirX";
const fetchHolidaysBtn = document.getElementById("fetch-holidays-btn");
const holidayTagsContainer = document.getElementById("holiday-tags-container");
const slHolidayYear = document.getElementById("sl-holiday-year");
const selectedHolidayDate = document.getElementById("selected-holiday-date");

fetchHolidaysBtn.addEventListener("click", async () => {
  const year = slHolidayYear.value;
  const cacheKey = `sl_holidays_${year}`;
  const cachedData = localStorage.getItem(cacheKey);

  if (cachedData) return renderHolidays(JSON.parse(cachedData), true);

  holidayTagsContainer.innerHTML =
    '<span style="font-size:13px; color:#64748b;">Fetching calendar data from the cloud...</span>';
  try {
    const response = await fetch(
      `https://calendarific.com/api/v2/holidays?api_key=${CALENDARIFIC_API_KEY}&country=LK&year=${year}`,
    );
    const data = await response.json();
    localStorage.setItem(cacheKey, JSON.stringify(data.response.holidays));
    renderHolidays(data.response.holidays, false);
  } catch (err) {
    holidayTagsContainer.innerHTML =
      '<span style="color:#ef4444; font-size:13px;">Failed to load calendar. Check API Key/Connection.</span>';
  }
});

function renderHolidays(holidays, isCached) {
  holidayTagsContainer.innerHTML = isCached
    ? '<span style="font-size:12px; color:#10b981; width: 100%; display: block; margin-bottom: 8px;">✓ Loaded instantly from device cache</span>'
    : '<span style="font-size:12px; color:#3b82f6; width: 100%; display: block; margin-bottom: 8px;">✓ Downloaded and saved to device for future use</span>';

  holidays.forEach((holiday) => {
    const tag = document.createElement("span");
    tag.className = "holiday-tag";
    tag.innerText = `${holiday.name} (${holiday.date.iso.split("T")[0]})`;
    tag.addEventListener("click", () => {
      document
        .querySelectorAll(".holiday-tag")
        .forEach((t) => t.classList.remove("selected"));
      tag.classList.add("selected");
      selectedHolidayDate.value = holiday.date.iso;
      document.getElementById("note-topic").value = holiday.name;
    });
    holidayTagsContainer.appendChild(tag);
  });
}

/* --- Dynamic Neon Theme Engine --- */
const colorPicker = document.getElementById("theme-color-picker");
const savedNeonColor = localStorage.getItem("dnNotesNeonTheme");
if (savedNeonColor) {
  document.documentElement.style.setProperty("--primary", savedNeonColor);
  colorPicker.value = savedNeonColor;
}
colorPicker.addEventListener("input", (e) =>
  document.documentElement.style.setProperty("--primary", e.target.value),
);
colorPicker.addEventListener("change", (e) =>
  localStorage.setItem("dnNotesNeonTheme", e.target.value),
);

/* --- Sidebar & Document Editor UI --- */
/* --- Sidebar & Document Editor UI --- */
toggleBtn.addEventListener("click", () => sidebar.classList.toggle("open"));

const fontSelect = document.getElementById("font-family");
const colorSelect = document.getElementById("font-color");
const btnBold = document.getElementById("btn-bold");
const btnItalic = document.getElementById("btn-italic");
const btnUnderline = document.getElementById("btn-underline");

// Dropdowns steal focus natively, so we force focus back to the editor after selection
fontSelect.addEventListener("change", function () {
  document.execCommand("fontName", false, this.value);
  editor.focus(); 
});
colorSelect.addEventListener("input", function () {
  document.execCommand("foreColor", false, this.value);
  editor.focus();
});

// Formatting Buttons: Prevent focus loss via 'mousedown' + preventDefault()
[
  { btn: btnBold, cmd: 'bold' },
  { btn: btnItalic, cmd: 'italic' },
  { btn: btnUnderline, cmd: 'underline' }
].forEach(({ btn, cmd }) => {
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault(); // CRITICAL: Stops the browser from moving the cursor to the button
    document.execCommand(cmd, false, null);
    updateToolbarState(); // Visually update the button to look pressed
  });
});

// Function to light up buttons if the cursor is on Bold/Italic/Underline text
function updateToolbarState() {
  btnBold.classList.toggle("active-tool", document.queryCommandState("bold"));
  btnItalic.classList.toggle("active-tool", document.queryCommandState("italic"));
  btnUnderline.classList.toggle("active-tool", document.queryCommandState("underline"));
}

// Check the style state whenever the user types or clicks inside the editor
editor.addEventListener("keyup", updateToolbarState);
editor.addEventListener("mouseup", updateToolbarState);
editor.addEventListener("focus", updateToolbarState);

/* --- Multi-device Live Data Stream --- */
function streamUserNotes() {
  if (!currentUser) return;
  if (unsubscribeNotes) unsubscribeNotes();

  const notesQuery = query(
    collection(db, "notes"),
    where("uid", "==", currentUser.uid),
    where("category", "==", activeCategory),
    orderBy("createdAt", "desc"),
  );

  unsubscribeNotes = onSnapshot(
    notesQuery,
    (snapshot) => {
      notesGrid.innerHTML = "";
      if (snapshot.empty) {
        notesGrid.innerHTML =
          '<p style="color:#64748b; font-size:14px; padding:10px;">No notes found under this category.</p>';
        return;
      }

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const card = document.createElement("div");
        card.className = `note-card ${data.isDone ? "done-card" : ""}`;

        let badge = data.isDone ? `<span class="done-badge">✓ DONE</span>` : "";

        card.innerHTML = `
          ${badge}
          <h4 style="${data.isDone ? "text-decoration: line-through; opacity: 0.7;" : ""}">${data.topic || "Untitled Note"}</h4>
          <p style="font-size:12px; color:#64748b;">Click to Open</p>
        `;

        card.addEventListener("click", () => openNoteModal(docSnap.id, data));
        notesGrid.appendChild(card);
      });
    },
    // NEW: Error handler added here!
    (error) => {
      console.error("Firestore Stream Error:", error);
      if (error.message.includes("requires an index")) {
        notesGrid.innerHTML = `
          <div style="padding:15px; border: 1px solid #ef4444; border-radius: 8px; background: rgba(239, 68, 68, 0.1);">
            <h4 style="color:#ef4444; margin-top:0;">⚠️ Missing Database Index</h4>
            <p style="font-size:13px; color:#e2e8f0;">Open your browser's Developer Tools (Press F12), go to the <b>Console</b> tab, and click the direct Firebase link to generate your missing index.</p>
          </div>
        `;
      }
    },
  );
}

/* --- Save Note Infrastructure --- */
saveBtn.addEventListener("click", async () => {
  if (!currentUser) return alert("Please authenticate with Google first.");
  const content = editor.innerHTML;
  const topic = topicInput.value.trim();

  if (!topic || editor.innerText.trim() === "")
    return alert("Please ensure Topic and Note Body spaces are populated.");

  const reminderTimes = Array.from(
    document.querySelectorAll(".reminder-time-input"),
  ).map((input) => input.value);

  const payload = {
    uid: currentUser.uid,
    category: activeCategory,
    topic: topic,
    content: content,
    isDone: false,
    createdAt: Date.now(),
    scheduling: {
      times: reminderTimes,
      type: durationSelect.value,
      repeatDays: [...selectedDays],
      startDate: document.getElementById("start-date").value,
      endDate: document.getElementById("end-date").value,
      singleDate: document.getElementById("specific-date").value,
      birthdayDate: document.getElementById("birthday-date").value,
      holidayDate: selectedHolidayDate.value,
    },
  };

  try {
    await addDoc(collection(db, "notes"), payload);
    editor.innerHTML = "";
    topicInput.value = "";
    // Removed the "Saved & Synced!" alert for a smoother UI experience.
    // The onSnapshot listener will automatically place the new note in the grid instantly.
  } catch (err) {
    console.error("Write execution dropped: ", err);
  }
});

/* --- Pop-up View Window Logic & Actions --- */
const noteModal = document.getElementById("note-modal");
const closeModal = document.querySelector(".close-modal");
const deleteNoteBtn = document.getElementById("delete-note-btn");
const markDoneBtn = document.getElementById("mark-done-btn");

function openNoteModal(docId, data) {
  activeModalNoteId = docId; // Store globally for action buttons
  document.getElementById("modal-title").innerText = data.topic;

  // Build a highly-detailed, clean HTML layout for your metadata
  let metaHTML = `<strong>Category:</strong> ${data.category.replace("-", " ").toUpperCase()}`;

  const sched = data.scheduling;
  if (sched) {
    if (data.category === "birthdays") {
      if (sched.birthdayDate) {
        metaHTML += `<br><strong>🎈 Event Date:</strong> ${sched.birthdayDate}`;
      }
    } else if (data.category === "special-days") {
      if (sched.holidayDate) {
        metaHTML += `<br><strong>🗓️ Holiday Date:</strong> ${sched.holidayDate}`;
      }
    } else {
      // Handle normal category durations
      let typeLabel = "Continuous / Lifetime";
      if (sched.type === "specific-date") {
        typeLabel = `📅 Single Specific Date (${sched.singleDate || "Not Specified"})`;
      } else if (sched.type === "range") {
        typeLabel = `⏳ Date Range (${sched.startDate || "N/A"} to ${sched.endDate || "N/A"})`;
      }

      metaHTML += `<br><strong>Type:</strong> ${typeLabel}`;

      // Add weekly repeating routine if present
      if (sched.repeatDays && sched.repeatDays.length > 0) {
        metaHTML += `<br><strong>🔁 Repeats On:</strong> ${sched.repeatDays.join(", ")}`;
      }
    }

    // Add designated alarm times
    if (sched.times && sched.times.length > 0) {
      metaHTML += `<br><strong>⏰ Reminders Scheduled:</strong> ${sched.times.join(", ")}`;
    }
  }

  // Swap innerText to innerHTML so formatting displays perfectly
  document.getElementById("modal-meta").innerHTML = metaHTML;
  document.getElementById("modal-body").innerHTML = data.content;

  // Toggle UI of Done button based on current status
  if (data.isDone) {
    markDoneBtn.innerText = "⟲ Mark as Undone";
    markDoneBtn.dataset.currentStatus = "done";
  } else {
    markDoneBtn.innerText = "✓ Mark as Done";
    markDoneBtn.dataset.currentStatus = "pending";
  }

  noteModal.classList.remove("hidden");
}

closeModal.addEventListener("click", () => noteModal.classList.add("hidden"));
window.addEventListener("click", (e) => {
  if (e.target === noteModal) noteModal.classList.add("hidden");
});

// Delete Note Execution
deleteNoteBtn.addEventListener("click", async () => {
  if (!activeModalNoteId) return;
  if (
    confirm(
      "Are you sure you want to permanently delete this note across all devices?",
    )
  ) {
    try {
      await deleteDoc(doc(db, "notes", activeModalNoteId));
      noteModal.classList.add("hidden");
    } catch (err) {
      alert("Failed to delete: " + err.message);
    }
  }
});

// Mark Note as Done Execution
markDoneBtn.addEventListener("click", async () => {
  if (!activeModalNoteId) return;
  const isCurrentlyDone = markDoneBtn.dataset.currentStatus === "done";
  try {
    // Toggle the boolean value in Firestore
    await updateDoc(doc(db, "notes", activeModalNoteId), {
      isDone: !isCurrentlyDone,
    });
    noteModal.classList.add("hidden");
  } catch (err) {
    alert("Failed to update status: " + err.message);
  }
});

/* --- Global Background Alarm Engine --- */
function startAlarmEngine() {
  if (!currentUser) return;
  if (unsubscribeAlarms) unsubscribeAlarms();
  if (alarmInterval) clearInterval(alarmInterval);

  // Stream ALL notes for the user, regardless of which category tab is active
  const allNotesQuery = query(
    collection(db, "notes"),
    where("uid", "==", currentUser.uid),
  );

  unsubscribeAlarms = onSnapshot(allNotesQuery, (snapshot) => {
    alarmNotes = [];
    snapshot.forEach((docSnap) => {
      alarmNotes.push({ id: docSnap.id, ...docSnap.data() });
    });
  });

  // Check the clock every 30 seconds
  alarmInterval = setInterval(checkAlarms, 30000);
}

function checkAlarms() {
  if (alarmNotes.length === 0) return;

  const now = new Date();
  const currentDay = now.toLocaleDateString("en-US", { weekday: "short" }); // e.g., "Mon"
  const currentDateStr = now.toLocaleDateString("en-CA"); // Gets local "YYYY-MM-DD" accurately
  const currentMonthDay = currentDateStr.substring(5); // "MM-DD"

  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const currentTimeStr = `${hours}:${minutes}`;

  alarmNotes.forEach((note) => {
    // Skip if note is done, or has no scheduling data
    if (
      note.isDone ||
      !note.scheduling ||
      !note.scheduling.times ||
      note.scheduling.times.length === 0
    )
      return;

    let dateMatches = false;
    const cat = note.category;
    const sched = note.scheduling;

    // Evaluate Date Matches based on category & duration type
    if (cat === "birthdays") {
      if (sched.birthdayDate && sched.birthdayDate.endsWith(currentMonthDay))
        dateMatches = true;
    } else if (cat === "special-days") {
      if (sched.holidayDate === currentDateStr) dateMatches = true;
    } else {
      if (
        sched.type === "specific-date" &&
        sched.singleDate === currentDateStr
      ) {
        dateMatches = true;
      } else if (
        sched.type === "range" &&
        sched.startDate <= currentDateStr &&
        sched.endDate >= currentDateStr
      ) {
        if (sched.repeatDays && sched.repeatDays.includes(currentDay))
          dateMatches = true;
      } else if (sched.type === "lifetime") {
        if (sched.repeatDays && sched.repeatDays.includes(currentDay))
          dateMatches = true;
      }
    }

    // If today is the day, and the time matches now
    if (dateMatches && sched.times.includes(currentTimeStr)) {
      const alarmKey = `${note.id}-${currentTimeStr}-${currentDateStr}`;

      // Ensure it only rings once per minute per note
      if (!triggeredAlarms.has(alarmKey)) {
        triggerAlarm(note);
        triggeredAlarms.add(alarmKey);
      }
    }
  });
}

function triggerAlarm(note) {
  // 1. Play the audio sound for exactly 5 seconds
  const alarmSound = document.getElementById("alarm-sound");
  if (alarmSound) {
    alarmSound.currentTime = 0;
    alarmSound.loop = true; // Force the short clip to loop

    alarmSound
      .play()
      .catch((e) =>
        console.warn("Audio blocked by browser auto-play policy:", e),
      );

    // Cut off the sound after 5000 milliseconds (5 seconds)
    setTimeout(() => {
      alarmSound.pause();
      alarmSound.currentTime = 0;
      alarmSound.loop = false;
    }, 5000);
  }

  // 2. Trigger OS Level Push Notification
  if ("Notification" in window && Notification.permission === "granted") {
    const title = `⏰ DN Notes: ${note.topic}`;
    const options = {
      body: "It is time! Click to view your task.",
      icon: "icons/icon-192.png",
      vibrate: [300, 100, 300, 100, 300], // Vibrates phone
      requireInteraction: true, // Forces notification to stay on screen until dismissed
      tag: note.id, // Prevents spamming multiple notifications for the same task
    };

    navigator.serviceWorker.ready.then((registration) => {
      registration.showNotification(title, options);
    });
  }
}
