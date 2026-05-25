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

// Intialize Firebase Application modules
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// System variables
let currentUser = null;
let activeCategory = "daily-habits";
let selectedDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
let unsubscribeNotes = null;

// Auth UI binding elements
const authForms = document.getElementById("auth-forms");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userProfileView = document.getElementById("user-profile");
const userAvatar = document.getElementById("user-avatar");
const userNameText = document.getElementById("user-name");

// New Email/Password bindings
const emailInput = document.getElementById("email-input");
const passwordInput = document.getElementById("password-input");
const confirmPasswordInput = document.getElementById("confirm-password-input");
const emailActionBtn = document.getElementById("email-action-btn");
const toggleAuthModeBtn = document.getElementById("toggle-auth-mode-btn");

let isSignUpMode = false;

// Toggle between Login and Sign Up views
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

// Handle Email / Password Execution
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
      // Optional: Clear form on success
      emailInput.value = "";
      passwordInput.value = "";
      confirmPasswordInput.value = "";
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    // Show the actual Firebase error to the user
    alert(`Authentication Error: ${err.message}`);
    console.error("Auth execution dropped: ", err);
  }
});

/* --- Authentication Watcher --- */
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    authForms.classList.add("hidden"); // Hide all forms
    userProfileView.classList.remove("hidden");

    // Email users don't have avatars by default, so we generate one
    userAvatar.src =
      user.photoURL ||
      `https://ui-avatars.com/api/?name=${user.email}&background=00e5ff&color=0b0f19`;

    // Use Display Name if available (Google), otherwise use the prefix of the email
    userNameText.innerText = user.displayName
      ? user.displayName.split(" ")[0]
      : user.email.split("@")[0];

    // Load Real-time, Cross-device Synchronized data
    streamUserNotes();
  } else {
    currentUser = null;
    userProfileView.classList.add("hidden");
    authForms.classList.remove("hidden"); // Show forms
    notesGrid.innerHTML =
      '<p style="padding:15px; color:#64748b;">Please login to load your cloud synced notes.</p>';
    if (unsubscribeNotes) unsubscribeNotes();
  }
});

// Handle Google Login (Now with proper error alerting)
loginBtn.addEventListener("click", () => {
  signInWithPopup(auth, provider).catch((err) => {
    console.error("Google Auth Error:", err);
    alert(
      `Google Sign-In Failed: ${err.message}. \nMake sure Google Auth is enabled in your Firebase Console.`,
    );
  });
});

logoutBtn.addEventListener("click", () => signOut(auth));

// App Structural UI bindings
const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("toggle-btn");
const editor = document.getElementById("editor");
const topicInput = document.getElementById("note-topic");
const saveBtn = document.getElementById("save-note-btn");
const notesGrid = document.getElementById("notes-grid");

// Habit Specific Custom Picker elements
const durationSelect = document.getElementById("habit-duration-type");
const rangeInputsWrap = document.getElementById("date-range-inputs");
const dayButtons = document.querySelectorAll(".day-dot");

// Modal Elements
const noteModal = document.getElementById("note-modal");
const closeModal = document.querySelector(".close-modal");

/* --- Sri Lankan Holidays API Integration (Optimized with Local Cache) --- */
const fetchHolidaysBtn = document.getElementById("fetch-holidays-btn");
const holidayTagsContainer = document.getElementById("holiday-tags-container");
const slHolidayYear = document.getElementById("sl-holiday-year");
const selectedHolidayDate = document.getElementById("selected-holiday-date");

// Paste your Calendarific API Key here
const CALENDARIFIC_API_KEY = "sbPplbaZdE6zrjhRItLSikyOycPAHirX";

fetchHolidaysBtn.addEventListener("click", async () => {
  const year = slHolidayYear.value;
  const cacheKey = `sl_holidays_${year}`; // e.g., "sl_holidays_2026"

  // 1. Check if we already have this year's data saved on the device
  const cachedData = localStorage.getItem(cacheKey);

  if (cachedData) {
    // Data exists! Parse it and render immediately without using the API
    const holidays = JSON.parse(cachedData);
    renderHolidays(holidays, true);
    return;
  }

  // 2. If no cache exists for this year, fetch it from the cloud
  holidayTagsContainer.innerHTML =
    '<span style="font-size:13px; color:#64748b;">Fetching calendar data from the cloud...</span>';

  try {
    const response = await fetch(
      `https://calendarific.com/api/v2/holidays?api_key=${CALENDARIFIC_API_KEY}&country=LK&year=${year}`,
    );
    const data = await response.json();
    const holidays = data.response.holidays;

    // 3. Save the fresh data to Local Storage so we never have to fetch it again this year
    localStorage.setItem(cacheKey, JSON.stringify(holidays));

    // Render the newly fetched data
    renderHolidays(holidays, false);
  } catch (err) {
    console.error("API Fetch Error:", err);
    holidayTagsContainer.innerHTML =
      '<span style="color:#ef4444; font-size:13px;">Failed to load calendar. Please check your API Key or connection.</span>';
  }
});

// Helper function to build the UI tags (keeps the code clean)
function renderHolidays(holidays, isCached) {
  // Add a neat little indicator so the user knows if it was instant or downloaded
  holidayTagsContainer.innerHTML = isCached
    ? '<span style="font-size:12px; color:#10b981; width: 100%; display: block; margin-bottom: 8px;">✓ Loaded instantly from device cache</span>'
    : '<span style="font-size:12px; color:#3b82f6; width: 100%; display: block; margin-bottom: 8px;">✓ Downloaded and saved to device for future use</span>';

  holidays.forEach((holiday) => {
    const tag = document.createElement("span");
    tag.className = "holiday-tag";
    tag.innerText = `${holiday.name} (${holiday.date.iso.split("T")[0]})`;

    tag.addEventListener("click", () => {
      // Remove selection from all tags, highlight clicked tag
      document
        .querySelectorAll(".holiday-tag")
        .forEach((t) => t.classList.remove("selected"));
      tag.classList.add("selected");

      // Set hidden input value for Firebase save
      selectedHolidayDate.value = holiday.date.iso;

      // Automatically make the holiday name the topic of the note
      document.getElementById("note-topic").value = holiday.name;
    });

    holidayTagsContainer.appendChild(tag);
  });
}

/* --- Dynamic Neon Theme Engine --- */
const colorPicker = document.getElementById("theme-color-picker");

// 1. Load the user's saved color from Local Storage when the app opens
const savedNeonColor = localStorage.getItem("dnNotesNeonTheme");
if (savedNeonColor) {
  document.documentElement.style.setProperty("--primary", savedNeonColor);
  colorPicker.value = savedNeonColor;
}

// 2. Change the entire app's glow and accent color in real-time as they drag the picker
colorPicker.addEventListener("input", (e) => {
  const newColor = e.target.value;
  document.documentElement.style.setProperty("--primary", newColor);
});

// 3. Save the final color choice to the browser's memory
colorPicker.addEventListener("change", (e) => {
  localStorage.setItem("dnNotesNeonTheme", e.target.value);
});

/* --- Sidebar Panel System --- */
toggleBtn.addEventListener("click", () => sidebar.classList.toggle("open"));

document.querySelectorAll("#sidebar li").bind = document
  .querySelectorAll("#sidebar li")
  .forEach((item) => {
    item.addEventListener("click", (e) => {
      document
        .querySelectorAll("#sidebar li")
        .forEach((li) => li.classList.remove("active"));
      item.classList.add("active");
      activeCategory = item.dataset.category;
      document.getElementById("active-view-category").innerText =
        item.innerText;

      manageSchedulingUI();
      streamUserNotes(); // Re-filter visual grids dynamically
    });
  });

/* --- Habit UI Functional Controls --- */
durationSelect.addEventListener("change", (e) => {
  if (e.target.value === "range") rangeInputsWrap.classList.remove("hidden");
  else rangeInputsWrap.classList.add("hidden");
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

function manageSchedulingUI() {
  const dailyHabitsBar = document.getElementById("scheduling-options");
  const specialDaysBar = document.getElementById("special-days-options");

  // Hide everything first
  dailyHabitsBar.classList.add("hidden");
  specialDaysBar.classList.add("hidden");

  // Show the correct tools based on user click
  if (activeCategory === "daily-habits") {
    dailyHabitsBar.classList.remove("hidden");
  } else if (activeCategory === "special-days") {
    specialDaysBar.classList.remove("hidden");
  }
}

/* --- Document Editor Execution Scripts --- */
document.getElementById("font-family").addEventListener("change", function () {
  document.execCommand("fontName", false, this.value);
});
document.getElementById("font-color").addEventListener("input", function () {
  document.execCommand("foreColor", false, this.value);
});

/* --- Multi-device Live Data Stream --- */
function streamUserNotes() {
  if (!currentUser) return;
  if (unsubscribeNotes) unsubscribeNotes(); // Clear previous active listeners

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

      snapshot.forEach((doc) => {
        const data = doc.data();
        const card = document.createElement("div");
        card.className = "note-card";
        card.innerHTML = `<h4>${data.topic || "Untitled Note"}</h4><p style="font-size:12px; color:#64748b;">Click to Read</p>`;

        card.addEventListener("click", () => openNoteModal(data));
        notesGrid.appendChild(card);
      });
    },
    (error) => {
      console.error(
        "Firestore security restrictions active or missing composite index: ",
        error,
      );
    },
  );
}

/* --- Save Note Infrastructure --- */
saveBtn.addEventListener("click", async () => {
  if (!currentUser)
    return alert(
      "Please authenticate with Google first to store synced configurations.",
    );
  const content = editor.innerHTML;
  const topic = topicInput.value.trim();

  if (!topic || editor.innerText.trim() === "")
    return alert("Please ensure Topic and Note Body spaces are populated.");

  const payload = {
    uid: currentUser.uid,
    category: activeCategory,
    topic: topic,
    content: content,
    createdAt: serverTimestamp(),
    scheduling: {
      time:
        activeCategory === "daily-habits"
          ? document.getElementById("reminder-time").value
          : null,
      type: activeCategory === "daily-habits" ? durationSelect.value : null,
      startDate:
        durationSelect.value === "range" && activeCategory === "daily-habits"
          ? document.getElementById("start-date").value
          : null,
      endDate:
        durationSelect.value === "range" && activeCategory === "daily-habits"
          ? document.getElementById("end-date").value
          : null,
      repeatDays: activeCategory === "daily-habits" ? [...selectedDays] : null,
      // Capture the holiday date if we are in the Special Days category
      holidayDate:
        activeCategory === "special-days" ? selectedHolidayDate.value : null,
    },
  };

  try {
    await addDoc(collection(db, "notes"), payload);
    editor.innerHTML = "";
    topicInput.value = "";
    alert("Synced successfully across connected accounts!");
  } catch (err) {
    console.error("Write execution dropped: ", err);
  }
});

/* --- Pop-up View Window Logic --- */
function openNoteModal(data) {
  document.getElementById("modal-title").innerText = data.topic;
  let metaText = `Category: ${data.category.replace("-", " ").toUpperCase()}`;
  if (data.scheduling && data.scheduling.time) {
    metaText += ` | Reminder: ${data.scheduling.time} (${data.scheduling.type})`;
  }
  document.getElementById("modal-meta").innerText = metaText;
  document.getElementById("modal-body").innerHTML = data.content;
  noteModal.classList.remove("hidden");
}

closeModal.addEventListener("click", () => noteModal.classList.add("hidden"));
window.addEventListener("click", (e) => {
  if (e.target === noteModal) noteModal.classList.add("hidden");
});
