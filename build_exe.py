import os
import sys
import subprocess
import shutil

def main():
    print("===========================================")
    print("  DFAS Package Compiler (PyInstaller)")
    print("===========================================")

    # 1. Ensure PyInstaller is installed
    try:
        import PyInstaller
    except ImportError:
        print("[!] PyInstaller is missing. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])
        print("[+] PyInstaller installed.")

    base_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.join(base_dir, "backend")
    frontend_dir = os.path.join(base_dir, "frontend")

    # Check if backend and frontend exist
    if not os.path.exists(backend_dir) or not os.path.exists(frontend_dir):
        print("[-] Required directories (backend/frontend) not found! Run this from the project root.")
        sys.exit(1)

    # 2. Set up PyInstaller command
    app_entry = os.path.join(backend_dir, "app.py")

    # Bundle frontend static files using --add-data
    # For Windows: format is SOURCE;DESTINATION
    # For Linux/Mac: SOURCE:DESTINATION
    separator = ";" if sys.platform.startswith('win') else ":"
    frontend_data_arg = f"{frontend_dir}{separator}frontend"

    # Important configurations
    # - --clean: Clean PyInstaller cache and remove temporary files
    # - --onefile: Create a one-file bundled executable
    # - --name dfas: The name of the built executable
    cmd = [
        "pyinstaller",
        "--clean",
        "--noconfirm",
        "--onefile",
        "--name", "dfas",
        f"--add-data={frontend_data_arg}",
    ]

    # Add hidden imports for dynamic blueprints / SQLAlchemy / Flask extensions
    hidden_imports = [
        "auth.routes",
        "api.catalog",
        "api.chat",
        "api.dashboard",
        "api.dataset",
        "api.evidence",
        "api.export",
        "api.insights",
        "api.results",
        "api.scan",
        "api.geo",
        "api.timeline",
        "api.heatmap",
        "api.schedule",
        "api.webhooks",
        "api.history",
        "api.audit",
        "api.admin",
        "sqlalchemy.ext.baked",
        "email_validator",
        "passlib.handlers.pbkdf2"
    ]
    for imp in hidden_imports:
        cmd.extend(["--hidden-import", imp])

    cmd.append("--paths=" + backend_dir) # Make sure backend modules resolve during analysis
    cmd.append(app_entry)

    # 3. Execute PyInstaller
    print(f"\n[*] Running: {' '.join(cmd)}\n")
    try:
        subprocess.check_call(cmd, cwd=base_dir)
        print("\n[+] SUCCESS! dfas.exe has been compiled in the 'dist' folder.")
    except subprocess.CalledProcessError as e:
        print(f"\n[-] Build failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
