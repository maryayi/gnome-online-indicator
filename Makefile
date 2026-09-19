UUID := online-indicator@maryayi.github.io
EXTENSIONS_DIR := $(HOME)/.local/share/gnome-shell/extensions
INSTALL_DIR := $(EXTENSIONS_DIR)/$(UUID)

.PHONY: install schemas pack clean

install: schemas
	mkdir -p $(EXTENSIONS_DIR)
	rm -rf $(INSTALL_DIR)
	ln -s $(CURDIR) $(INSTALL_DIR)

schemas:
	glib-compile-schemas schemas/

pack: schemas
	gnome-extensions pack --force \
		--extra-source=pinger.js \
		--extra-source=stylesheet.css \
		--extra-source=icons \
		--extra-source=LICENSE \
		.

clean:
	rm -f schemas/gschemas.compiled
	rm -f $(UUID).shell-extension.zip
