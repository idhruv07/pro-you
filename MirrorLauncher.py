import tkinter as tk
from tkinter import simpledialog, messagebox
import json
import subprocess
import threading
import os
import time

DEVICES_FILE = "devices.json"

class MirrorLauncher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Android Mirror Dashboard")
        self.geometry("500x400")
        
        # Load Data
        self.devices = self.load_devices()

        # UI Layout
        self.create_widgets()
        self.refresh_device_list()

    def load_devices(self):
        if not os.path.exists(DEVICES_FILE):
            return []
        try:
            with open(DEVICES_FILE, 'r') as f:
                return json.load(f)
        except:
            return []

    def save_devices(self):
        with open(DEVICES_FILE, 'w') as f:
            json.dump(self.devices, f, indent=4)

    def create_widgets(self):
        # Header
        header_frame = tk.Frame(self)
        header_frame.pack(fill=tk.X, padx=10, pady=10)
        
        tk.Label(header_frame, text="My Devices", font=("Arial", 16, "bold")).pack(side=tk.LEFT)
        tk.Button(header_frame, text="+ Add Device", command=self.add_device).pack(side=tk.RIGHT)
        tk.Button(header_frame, text="Wireless Pairing", command=self.open_pairing_dialog).pack(side=tk.RIGHT, padx=10)

        # Device List Area
        self.device_list_frame = tk.Frame(self)
        self.device_list_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

        # Status Bar
        self.status_var = tk.StringVar()
        self.status_var.set("Ready")
        tk.Label(self, textvariable=self.status_var, bd=1, relief=tk.SUNKEN, anchor=tk.W).pack(side=tk.BOTTOM, fill=tk.X)

    def refresh_device_list(self):
        # Clear existing
        for widget in self.device_list_frame.winfo_children():
            widget.destroy()

        for idx, device in enumerate(self.devices):
            frame = tk.Frame(self.device_list_frame, bd=1, relief=tk.RAISED)
            frame.pack(fill=tk.X, pady=5)

            # Info
            info_text = f"{device['name']} ({device['ip']})"
            tk.Label(frame, text=info_text, font=("Arial", 12)).pack(side=tk.LEFT, padx=10, pady=10)

            # Actions
            tk.Button(frame, text="Connect", bg="#4CAF50", command=lambda d=device: self.connect_device(d)).pack(side=tk.RIGHT, padx=5)
            tk.Button(frame, text="Edit", command=lambda i=idx: self.edit_device(i)).pack(side=tk.RIGHT, padx=5)
            tk.Button(frame, text="Delete", fg="red", command=lambda i=idx: self.delete_device(i)).pack(side=tk.RIGHT, padx=5)

    def add_device(self):
        name = simpledialog.askstring("Add Device", "Device Name (e.g. Pixel 7):")
        if not name: return
        ip = simpledialog.askstring("Add Device", "IP Address (e.g. 192.168.1.5):")
        if not ip: return

        self.devices.append({"name": name, "ip": ip})
        self.save_devices()
        self.refresh_device_list()

    def edit_device(self, index):
        device = self.devices[index]
        new_name = simpledialog.askstring("Edit Device", "Device Name:", initialvalue=device['name'])
        if not new_name: return
        new_ip = simpledialog.askstring("Edit Device", "IP Address:", initialvalue=device['ip'])
        if not new_ip: return

        self.devices[index] = {"name": new_name, "ip": new_ip}
        self.save_devices()
        self.refresh_device_list()

    def delete_device(self, index):
        if messagebox.askyesno("Delete", "Remove this device?"):
            del self.devices[index]
            self.save_devices()
            self.refresh_device_list()

    def connect_device(self, device):
        ip = device['ip']
        self.status_var.set(f"Connecting to {device['name']} ({ip})...")
        
        def run_connect():
            try:
                # 1. Connect via ADB
                cmd_connect = ["adb", "connect", f"{ip}:5555"]
                result = subprocess.run(cmd_connect, capture_output=True, text=True)
                
                if "connected to" in result.stdout or "already connected" in result.stdout:
                    self.status_var.set(f"Launching scrcpy for {device['name']}...")
                    
                    # 2. Launch scrcpy
                    cmd_scrcpy = ["scrcpy", "-s", f"{ip}:5555", "--video-bit-rate", "4M", "--turn-screen-off", "--stay-awake"]
                    subprocess.Popen(cmd_scrcpy)
                    
                    self.status_var.set(f"Connected to {device['name']}")
                else:
                    self.status_var.set(f"Failed to connect to {ip}")
                    messagebox.showerror("Connection Failed", f"Could not connect to {ip}.\n\nEnsure phone is on Wi-Fi and TCP/IP mode is enabled.\nOutput: {result.stdout}")
            except Exception as e:
                self.status_var.set("Error occurred")
                messagebox.showerror("Error", str(e))

        threading.Thread(target=run_connect).start()

    def open_pairing_dialog(self):
        win = tk.Toplevel(self)
        win.title("Wireless Pairing (Android 11+)")
        win.geometry("400x300")

        tk.Label(win, text="1. Go to Settings > Developer Options > Wireless Debugging").pack(pady=5)
        tk.Label(win, text="2. Tap 'Pair device with pairing code'").pack(pady=5)

        tk.Label(win, text="IP Address & Port (e.g. 192.168.1.5:33445):").pack(pady=(10,0))
        entry_addr = tk.Entry(win, width=30)
        entry_addr.pack()

        tk.Label(win, text="Pairing Code (6 digits):").pack(pady=(10,0))
        entry_code = tk.Entry(win, width=15)
        entry_code.pack()

        def do_pair():
            addr = entry_addr.get().strip()
            code = entry_code.get().strip()
            
            if not addr or not code:
                messagebox.showwarning("Missing Info", "Please enter both Address and Code")
                return

            def pair_thread():
                try:
                    cmd = ["adb", "pair", addr, code]
                    res = subprocess.run(cmd, capture_output=True, text=True)
                    if res.returncode == 0:
                        messagebox.showinfo("Success", "Pairing Successful!\n\nNow add the device IP (from main Wireless Debugging screen) to your list and connect.")
                        win.destroy()
                    else:
                        messagebox.showerror("Failed", f"Pairing Failed:\n{res.stdout}\n{res.stderr}")
                except Exception as e:
                    messagebox.showerror("Error", str(e))
            
            threading.Thread(target=pair_thread).start()

        tk.Button(win, text="Pair", command=do_pair, bg="#2196F3", fg="white").pack(pady=20)


if __name__ == "__main__":
    app = MirrorLauncher()
    app.mainloop()
