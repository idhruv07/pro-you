 #!/bin/bash

# scrcpy Wi-Fi Helper
# Automates the process of connecting to an Android device over Wi-Fi and running scrcpy.

adb_path=$(which adb)
scrcpy_path=$(which scrcpy)

if [ -z "$adb_path" ]; then
    echo "Error: adb not found. Please install android-platform-tools."
    exit 1
fi

if [ -z "$scrcpy_path" ]; then
    echo "Error: scrcpy not found. Please brew install scrcpy."
    exit 1
fi

# --- Device Configuration ---
# Set static IPs here if you want to bypass detection.
# You can find your phone's IP in Settings > About Phone > Status.

# OnePlus Device
TARGET_DEVICE_IP="192.168.1.8" 
# TARGET_DEVICE_IP="10.223.98.163" # Alternate IP seen in logs

# Pixel Device (Uncomment to use)
# TARGET_DEVICE_IP="192.168.1.100" 

if [ -n "$TARGET_DEVICE_IP" ]; then
    echo "Using configured device IP: $TARGET_DEVICE_IP"
    
    # Try connecting directly
    echo "Connecting to $TARGET_DEVICE_IP:5555..."
    connect_output=$($adb_path connect "$TARGET_DEVICE_IP:5555")
    echo "$connect_output"
    
    # Check if output contains "connected to"
    if [[ "$connect_output" == *"connected to"* ]]; then
        echo "Connection successful!"
        echo "Starting scrcpy..."
        $scrcpy_path -s "$TARGET_DEVICE_IP:5555" --turn-screen-off --stay-awake --max-size 1024 --video-bit-rate 4M
        exit 0
    else
        echo "Failed to connect to configured IP. Falling back to detection/pairing..."
        echo "(Your phone might have rebooted or lost Wi-Fi debug mode. Try Option 2 below to re-pair.)"
        echo ""
    fi
fi

echo "=== Android Wi-Fi Mirroring (scrcpy) ==="
echo "1. Connect your Android device via USB first to initialize Wi-Fi mode."
echo "   (If already initialized, you can skip USB connection)"
echo "2. Make sure your Mac and Android are on the SAME Wi-Fi network."
echo ""

# Check connected devices
devices_output=$($adb_path devices | grep -v "List" | grep "device$")
device_count=$(echo "$devices_output" | wc -l)

if [ -z "$devices_output" ]; then
    echo "No devices connected via USB or Wi-Fi."
    echo ""
    echo "--- Option 1: Classic Method (Requires USB for first setup) ---"
    echo "   Plug in your phone now and re-run this script."
    echo ""
    echo "--- Option 2: Wireless Debugging (No USB required, Android 11+) ---"
    echo "   1. Go to Settings > Developer Options > Wireless Debugging."
    echo "   2. Enable 'Wireless Debugging'."
    echo "   3. Tap 'Pair device with pairing code'."
    echo ""
    read -p "Do you want to pair using Wireless Debugging? (y/n): " use_pairing
    
    if [[ "$use_pairing" =~ ^[Yy]$ ]]; then
        read -p "Enter IP address and Port from phone (e.g. 192.168.1.5:38491): " pair_ip_port
        read -p "Enter 6-digit Wi-Fi Pairing Code: " pair_code
        
        if [ -n "$pair_ip_port" ] && [ -n "$pair_code" ]; then
            echo "Pairing with $pair_ip_port..."
            $adb_path pair "$pair_ip_port" "$pair_code"
            
            if [ $? -eq 0 ]; then
                echo "Pairing successful!"
                echo ""
                echo "IMPORTANT: Now look at the main 'Wireless Debugging' screen again."
                read -p "Enter the IP address and Port shown there (e.g. 192.168.1.5:41234): " connect_ip_port
                
                if [ -n "$connect_ip_port" ]; then
                    echo "Connecting..."
                    $adb_path connect "$connect_ip_port"
                fi
            else
                echo "Pairing failed."
                exit 1
            fi
        else
            echo "Missing info. Exiting."
            exit 1
        fi
    else
        exit 0
    fi
    
    # Refresh devices list after pairing
    devices_output=$($adb_path devices | grep -v "List" | grep "device$")
    device_count=$(echo "$devices_output" | wc -l)
fi

# Re-check devices final time
if [ -z "$devices_output" ]; then
    echo "Still no devices found. Exiting."
    exit 1
fi

echo ""
echo "Found $device_count device(s):"
echo "$devices_output" | nl -w2 -s") "
echo ""

if [ "$device_count" -gt 1 ]; then
    read -p "Enter the number of the device to use: " device_num
    target_device=$(echo "$devices_output" | sed -n "${device_num}p" | awk '{print $1}')
else
    target_device=$(echo "$devices_output" | awk '{print $1}')
    read -p "Use device '$target_device'? [Y/n] " confirm
    if [[ "$confirm" =~ ^[Nn]$ ]]; then
        echo "Exiting."
        exit 0
    fi
fi

if [ -z "$target_device" ]; then
    echo "Invalid selection."
    exit 1
fi

# Main Logic using $target_device
if [[ "$target_device" =~ [0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:5555 ]]; then
    # Already Wi-Fi
    device_ip=$(echo $target_device | awk -F: '{print $1}')
    echo "Connecting to existing Wi-Fi device $target_device..."
else
    # USB Device
    echo "Initializing Wi-Fi mode for $target_device..."
    $adb_path -s $target_device tcpip 5555
    sleep 3
    
    echo "Attempting to auto-detect IP address..."
    device_ip=$($adb_path -s $target_device shell ip route | awk '{print $9}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)
    
    if [ -z "$device_ip" ]; then
        echo "Could not auto-detect IP."
        read -p "Please enter Android Device IP found in Settings > About Phone > Status: " device_ip
    else
        echo "Detected IP: $device_ip"
    fi
    echo "You can now disconnect the USB cable if you wish."
fi

if [ -n "$device_ip" ]; then
    echo "Connecting to $device_ip:5555..."
    $adb_path connect "$device_ip:5555"
    
    if [ $? -eq 0 ]; then
        echo "Connection successful!"
        echo "Starting scrcpy..."
        $scrcpy_path -s "$device_ip:5555" --turn-screen-off --stay-awake --max-size 1024 --video-bit-rate 4M
    else
        echo "Failed to connect to $device_ip. Check IP and Wi-Fi connection."
    fi
fi
