import socket
import cv2
import os
import sys
import threading
import time

def run_server(host='0.0.0.0', port=5001):
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    
    try:
        server_socket.bind((host, port))
    except OSError as e:
        print(f"Error binding to port {port}: {e}")
        return

    server_socket.listen(1)
    print(f"Listening on {host}:{port}...")

    # Named pipe for real-time streaming
    pipe_path = "mirror_pipe"
    
    # Clean up previous pipe if exists
    if os.path.exists(pipe_path):
        os.remove(pipe_path)
    
    try:
        os.mkfifo(pipe_path)
        print(f"Created named pipe: {pipe_path}")
    except OSError as e:
        print(f"Failed to create named pipe: {e}")
        return

    while True:
        try:
            print("\nWaiting for connection...")
            conn, addr = server_socket.accept()
            print(f"Connection from: {addr}")

            # Thread to bridge Socket -> Pipe
            def socket_to_pipe():
                try:
                    # Open pipe for writing (this blocks until reader opens it)
                    print("Opening pipe for writing...")
                    pipe_fd = os.open(pipe_path, os.O_WRONLY)
                    pipe_file = os.fdopen(pipe_fd, 'wb')
                    print("Pipe opened for writing.")

                    total_bytes = 0
                    while True:
                        data = conn.recv(32*1024)
                        if not data:
                            print("\nSocket closed by client.")
                            break
                        pipe_file.write(data)
                        pipe_file.flush()
                        
                        total_bytes += len(data)
                        if total_bytes % (1024 * 1024) < 32768:
                            print(f"Transfer: {total_bytes / 1024 / 1024:.2f} MB", end='\r')
                            
                except BrokenPipeError:
                     print("\nPipe closed by reader.")
                except Exception as e:
                    print(f"\nSocket/Pipe error: {e}")
                finally:
                    try:
                        conn.close()
                    except: pass
                    try:
                        pipe_file.close() # Can throw if not opened
                    except: pass
                    print("\nSocket reader thread finished.")

            writer_thread = threading.Thread(target=socket_to_pipe, daemon=True)
            writer_thread.start()

            # Main thread: Read from Pipe using OpenCV
            print("Opening pipe with OpenCV...")
            # OpenCV VideoCapture will block until data starts flowing if reading from pipe?
            # Actually, opening a pipe for reading blocks until a writer opens it.
            # But the writer thread is starting now, so it should sync up.
            
            cap = cv2.VideoCapture(pipe_path)
            
            if not cap.isOpened():
                print("Failed to open pipe with OpenCV.")
                # Ensure we don't hang if OpenCV fails immediately
                conn.close() 
            else:
                print("OpenCV stream started!")
                frame_count = 0
                while True:
                    ret, frame = cap.read()
                    if not ret:
                        print("Stream ended (no frame).")
                        break
                    
                    cv2.imshow('Android Mirror', frame)
                    
                    if cv2.waitKey(1) & 0xFF == ord('q'):
                        print("Quitting...")
                        break
                        
                    frame_count += 1
                    if frame_count % 30 == 0:
                        # Clear line to avoid overwriting transfer log purely
                        pass 

                cap.release()
                print(f"\nTotal frames displayed: {frame_count}")
            
            cv2.destroyAllWindows()
            conn.close() # Ensure socket is closed if OpenCV exits loop

        except KeyboardInterrupt:
            print("\nServer stopping...")
            break
        except Exception as e:
            print(f"Server error: {e}")
            import traceback
            traceback.print_exc()

    # Cleanup
    server_socket.close()
    if os.path.exists(pipe_path):
        os.remove(pipe_path)

def start_discovery_responder(port=5002):
    """Respond to UDP broadcasts for server auto-discovery."""
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        udp_socket.bind(('0.0.0.0', port))
        print(f"[*] Discovery service listening on UDP port {port}...")
        while True:
            data, addr = udp_socket.recvfrom(1024)
            if data == b"DISCOVER_MIRROR_SERVER":
                udp_socket.sendto(b"MIRROR_SERVER_OK", addr)
                print(f"[+] Discovered by client at {addr[0]}")
    except Exception as e:
        print(f"Discovery responder error: {e}")
    finally:
        udp_socket.close()

if __name__ == "__main__":
    # Start discovery responder in separate thread
    discovery_thread = threading.Thread(target=start_discovery_responder, daemon=True)
    discovery_thread.start()
    
    run_server()

