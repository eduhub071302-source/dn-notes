import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  serverTimestamp,
  deleteDoc, // NEW
  doc, // NEW
  updateDoc, // NEW
  enableIndexedDbPersistence,
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

const firebaseConfig = {
  apiKey: "AIzaSyDrIpkCiUtGJMoIso8MIfo1YoFSH3FCH7A",
  authDomain: "dn-notes-73371.firebaseapp.com",
  projectId: "dn-notes-73371",
  storageBucket: "dn-notes-73371.firebasestorage.app",
  messagingSenderId: "915761462285",
  appId: "1:915761462285:web:8ffbbd34422f0da26c6944",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// NEW: Enable offline local storage.
// This forces the app to load from device storage first, drastically reducing Firestore reads!
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code == "failed-precondition") {
    console.log(
      "Multiple tabs open, persistence can only be enabled in one tab at a a time.",
    );
  } else if (err.code == "unimplemented") {
    console.log(
      "The current browser does not support all of the features required to enable persistence.",
    );
  }
});

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let currentUser = null;
let activeCategory = "daily-habits";
let selectedDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
let unsubscribeNotes = null;
let activeModalNoteId = null; // Tracks the currently opened note ID for Delete/Done ops

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
  } else {
    currentUser = null;
    userProfileView.classList.add("hidden");
    authForms.classList.remove("hidden");
    document.getElementById("notes-grid").innerHTML =
      '<p style="padding:15px; color:#64748b;">Please login to load your cloud synced notes.</p>';
    if (unsubscribeNotes) unsubscribeNotes();
  }
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
toggleBtn.addEventListener("click", () => sidebar.classList.toggle("open"));
document.getElementById("font-family").addEventListener("change", function () {
  document.execCommand("fontName", false, this.value);
});
document.getElementById("font-color").addEventListener("input", function () {
  document.execCommand("foreColor", false, this.value);
});

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

  unsubscribeNotes = onSnapshot(notesQuery, (snapshot) => {
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

      // Pass the Document ID to the modal so we can delete or update it later
      card.addEventListener("click", () => openNoteModal(docSnap.id, data));
      notesGrid.appendChild(card);
    });
  });
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
    createdAt: serverTimestamp(),
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

  let metaText = `Category: ${data.category.replace("-", " ").toUpperCase()}`;
  if (
    data.scheduling &&
    data.scheduling.times &&
    data.scheduling.times.length > 0
  ) {
    metaText += ` | Reminders: ${data.scheduling.times.join(", ")}`;
  }

  document.getElementById("modal-meta").innerText = metaText;
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
