frappe.pages['ocr-checker'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'OCR Checker',
        single_column: true
    });

    var $content = $(
        `<div class="container-fluid ocr-checker-page">
            <div class="row">
                <div class="col-12">
                    <div class="card mb-4">
                        <div class="card-body">
                            <div class="d-flex flex-column flex-md-row justify-content-between align-items-start mb-3 gap-2">
                                <div>
                                    <h5 class="card-title">OCR Checker</h5>
                                    <p class="text-muted mb-0">Open this page from a Pdf Page. The image and JSON files will load automatically and render bounding boxes.</p>
                                </div>
                                <span id="ocrCheckerSegmentCount" class="badge bg-secondary">0 segments</span>
                            </div>

                            <div id="ocrCheckerControls" class="d-flex flex-column flex-md-row align-items-start mb-3" style="gap: 12px;">
                                <div class="d-flex flex-wrap" style="gap: 10px;">
                                    <button id="mergeBoxesBtn" class="btn btn-primary btn-sm" disabled>Merge selected</button>
                                    <button id="deleteBoxBtn" class="btn btn-danger btn-sm" disabled>Delete selected</button>
                                    <button id="clearSelectionBtn" class="btn btn-secondary btn-sm" type="button">Clear selection</button>
                                    <button id="drawBoxBtn" class="btn btn-outline-info btn-sm" type="button">Draw Box</button>
                                    <button id="processDrawnBoxBtn" class="btn btn-warning btn-sm" type="button" style="display: none;">Process Box</button>
                                    <button id="verifyPageBtn" class="btn btn-success btn-sm d-none">Mark page verified</button>
                                </div>
                                <div class="ms-md-auto text-muted small">Selected: <span id="ocrCheckerSelectedCount">0</span></div>
                            </div>

                            <div id="ocrCheckerFrame" class="d-flex justify-content-center bg-light border" style="min-height: 320px; position: relative; overflow: hidden; touch-action: none;">
                                <div id="ocrCheckerZoomContainer" style="transform-origin: 0 0; will-change: transform;">
                                    <div id="ocrCheckerImageWrapper" class="position-relative" style="display: none;">
                                        <img id="ocrCheckerImage" src="" style="display: block; max-width: 100%; height: auto;" />
                                        <div id="ocrCheckerOverlay" style="position: absolute; top: 0; left: 0; pointer-events: none;"></div>
                                    </div>
                                </div>
                            </div>

                            <div id="ocrCheckerDetails" class="card mt-3 d-none">
                                <div class="card-body"></div>
                            </div>

                            <div id="ocrCheckerStatus" class="mt-3 text-muted"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`
    );

    page.body.append($content);

    var $status = $content.find('#ocrCheckerStatus');
    var $segmentCount = $content.find('#ocrCheckerSegmentCount');
    var $image = $content.find('#ocrCheckerImage');
    var $imageWrapper = $content.find('#ocrCheckerImageWrapper');
    var $overlay = $content.find('#ocrCheckerOverlay');
    var $mergeBtn = $content.find('#mergeBoxesBtn');
    var $deleteBtn = $content.find('#deleteBoxBtn');
    var $clearSelectionBtn = $content.find('#clearSelectionBtn');
    var $verifyPageBtn = $content.find('#verifyPageBtn');
    var $drawBoxBtn = $content.find('#drawBoxBtn');
    var $processDrawnBoxBtn = $content.find('#processDrawnBoxBtn');
    var $selectedCount = $content.find('#ocrCheckerSelectedCount');
    var $detailsCard = $content.find('#ocrCheckerDetails');
    var $detailsBody = $detailsCard.find('.card-body');

    var isDrawingMode = false;
    var isDrawing = false;
    var drawStartX = 0;
    var drawStartY = 0;
    var drawnBoxCoords = null;

    var boxes = [];
    var nextBoxId = 0;
    var selectedBoxIds = new Set();
    var currentImageUrl = null;
    var currentJsonUrl = null;
    var jsonData = null;
    var pageId = null;

    function setStatus(message, type) {
        $status.removeClass('text-success text-danger text-muted');
        $status.addClass(type || 'text-muted');
        $status.text(message);
    }

    function getQueryParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    function parseLocationFromImageUrl(imageUrl) {
        if (!imageUrl) {
            return null;
        }

        var url = imageUrl;
        try {
            url = new URL(imageUrl, window.location.origin).pathname;
        } catch (e) {
            url = imageUrl.split('?')[0];
        }

        var filename = url.split('/').pop().split('?')[0];
        filename = filename.replace(/\.[^/.]+$/, '');
        // Match veerpasli_{location}_{year}_{anything} — page number may have a hash suffix
        var match = filename.match(/^veerpasli_(.+)_(\d{4})[-_]/i);
        if (match) {
            return match[1];
        }
        match = filename.match(/^veerpasli-(.+)-\d{4}-/i);
        return match ? match[1] : filename;
    }
    function initStyles() {
        if (document.getElementById('ocrCheckerStyles')) {
            return;
        }

        var style = document.createElement('style');
        style.id = 'ocrCheckerStyles';
        style.innerHTML = `
            .ocr-box { position: absolute; box-sizing: border-box; cursor: pointer; transition: border-color 0.2s ease, background-color 0.2s ease; pointer-events: auto; }
            .ocr-box-original { border: 2px solid rgba(255, 0, 0, 0.75); background: rgba(255, 0, 0, 0.10); }
            .ocr-box-merged { border: 2px solid rgba(0, 123, 255, 0.75); background: rgba(0, 123, 255, 0.10); }
            .ocr-box-complete { border: 2px solid rgba(40, 167, 69, 0.85); background: rgba(40, 167, 69, 0.10); }
            .ocr-box-verified { border: 3px solid rgba(40, 167, 69, 0.95); background: rgba(40, 167, 69, 0.15); }
            .ocr-box-selected { outline: 3px solid rgba(255, 193, 7, 0.85); outline-offset: -3px; }
            .ocr-box:hover { filter: saturate(1.2); }
            .ocr-box-split-icon {
                 position: absolute;
                 top: -10px;
                 right: -10px;
                 width: 20px;
                 height: 20px;
                 border: none;
                 border-radius: 50%;
                 background: rgba(255,255,255,0.95);
                 padding: 0;
                 color: #dc3545;
                 font-size: 12px;
                 box-sizing: border-box;
                 display: flex;
                 align-items: center;
                 justify-content: center;
                 cursor: pointer;
                 box-shadow: 0 1px 4px rgba(0,0,0,0.2);
                 z-index: 20;
            }
            .ocr-checker-field { margin-bottom: 1rem; }
            .ocr-token { display: inline-flex; align-items: center; position: relative; padding: 0.25rem 0.5rem; margin: 0.2rem; border: 1px solid #dee2e6; background-color: #f8f9fa; border-radius: 4px; transition: all 0.15s ease-in-out; cursor: pointer; font-family: monospace; font-size: 0.95rem; }
            .ocr-token .ocr-token-delete { display: none; position: absolute; top: -7px; right: -7px; width: 16px; height: 16px; border-radius: 50%; background: #dc3545; color: #fff; font-size: 10px; line-height: 16px; text-align: center; cursor: pointer; z-index: 5; border: 1.5px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.25); }
            .ocr-token:hover .ocr-token-delete { display: block; }
            .ocr-token-new-input { display: inline-block; border: none; outline: none; font-family: monospace; font-size: 0.95rem; min-width: 60px; max-width: 200px; background: transparent; vertical-align: middle; padding: 0.25rem 0.1rem; }
            .ocr-token-order { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; border-radius: 50%; background: rgba(255,255,255,0.85); color: #212529; font-size: 9px; font-weight: 700; line-height: 1; margin-left: 4px; padding: 0 3px; box-shadow: 0 1px 2px rgba(0,0,0,0.2); flex-shrink: 0; }
            .ocr-token:hover { background-color: #e9ecef; border-color: #adb5bd; }
            .ocr-token-selected { background: #212529; color: #fff; border-color: #212529; }
            .ocr-token-name.ocr-token-selected { background-color: #0d6efd; color: #fff; border-color: #0d6efd; }
            .ocr-token-village.ocr-token-selected { background-color: #6610f2; color: #fff; border-color: #6610f2; }
            .ocr-token-amount.ocr-token-selected { background-color: #fd7e14; color: #fff; border-color: #fd7e14; }
            .ocr-token-phone.ocr-token-selected { background-color: #198754; color: #fff; border-color: #198754; }
            [class*="ocr-token-haste_"].ocr-token-selected { background-color: #ffc107; color: #000; border-color: #ffc107; }
            #ocrCheckerFrame { -webkit-overflow-scrolling: touch; }
            #ocrCheckerFrame, #ocrCheckerFrame * { touch-action: none; -webkit-user-select: none; user-select: none; }
            #ocrCheckerOverlay { pointer-events: none; }
            #ocrCheckerOverlay .ocr-box { pointer-events: auto; }
            .ocr-box-drawing { border: 2px dashed #6f42c1; background: rgba(111, 66, 193, 0.15); pointer-events: none; position: absolute; z-index: 100; box-sizing: border-box; }
            .ocr-drawing-mode { cursor: crosshair !important; }
            .ocr-drawing-mode .ocr-box { pointer-events: none !important; }
            @media (max-width: 768px) {
                #ocrCheckerFrame { min-height: 300px; }
                .ocr-box-original { border-width: 1px; }
                .ocr-box-merged { border-width: 1px; }
                .ocr-box-complete { border-width: 1px; }
                .ocr-box-verified { border-width: 1.5px; }
                .ocr-box-selected { outline-width: 2px; outline-offset: -2px; }
                .ocr-box-split-icon { width: 16px; height: 16px; padding: 1px; top: -8px; right: -8px; }
            } }
        `;
        document.head.appendChild(style);
    }

    function clearPreview() {
        $image.attr('src', '').hide();
        $imageWrapper.hide();
        $overlay.empty();
        $segmentCount.text('0 segments');
        $detailsCard.addClass('d-none');
        selectedBoxIds.clear();
        boxes = [];
        nextBoxId = 0;
        $selectedCount.text('0');
        setStatus('Open this page from a Pdf page with image and JSON query parameters.');
    }

    function createBox(segment, status) {
        return {
            id: nextBoxId++,
            text: segment.text || '',
            boundingBox: segment.boundingBox || null,
            status: segment.status || status || 'original',
            selected: false,
            mergedIds: [],
            sourceSegments: [{
                text: segment.text,
                boundingBox: segment.boundingBox
            }],
            fields: segment.fields || {
                name: '',
                village: '',
                amount: '',
                phone: '',
                donation_date: ''
            }
        };
    }

    var fieldNames = ['name', 'village', 'amount', 'phone'];

    function isCompleteBox(box) {
        return box.fields.name && box.fields.village && (box.fields.amount || box.fields.phone);
    }

    function tokenizeText(text, splitByHyphen) {
        var tokens = [];
        var regex = /(\S+\s*)/g;
        var match;
        while ((match = regex.exec(text))) {
            var word = match[1];
            if (splitByHyphen) {
                var parts = word.split(/([-—–])/);
                parts.forEach(function (part) {
                    if (part !== '') {
                        tokens.push({
                            value: part,
                            label: part.trim()
                        });
                    }
                });
            } else {
                tokens.push({
                    value: word,
                    label: word.trim()
                });
            }
        }
        return tokens;
    }

    function splitBoxByTokenSelection(box, tokens, selectedTokenIds) {
        var selectedIndexes = Array.from(selectedTokenIds).sort(function (a, b) { return a - b; });
        if (!selectedIndexes.length) {
            return null;
        }
        for (var i = 1; i < selectedIndexes.length; i++) {
            if (selectedIndexes[i] !== selectedIndexes[i - 1] + 1) {
                return null;
            }
        }

        var firstSelected = selectedIndexes[0];
        var lastSelected = selectedIndexes[selectedIndexes.length - 1];

        // Group tokens
        var leftTokens = tokens.slice(0, firstSelected);
        var midTokens = tokens.slice(firstSelected, lastSelected + 1);
        var rightTokens = tokens.slice(lastSelected + 1);

        // Sum lengths
        var leftLength = leftTokens.reduce(function (sum, t) { return sum + t.value.length; }, 0);
        var midLength = midTokens.reduce(function (sum, t) { return sum + t.value.length; }, 0);
        var rightLength = rightTokens.reduce(function (sum, t) { return sum + t.value.length; }, 0);
        var totalLength = leftLength + midLength + rightLength;

        if (totalLength === 0) return null;

        var bb = box.boundingBox;
        var leftEdge = bb.centerPerX - bb.perWidth / 2;

        var leftWidth = bb.perWidth * (leftLength / totalLength);
        var midWidth = bb.perWidth * (midLength / totalLength);
        var rightWidth = bb.perWidth * (rightLength / totalLength);

        var resultBoxes = [];

        var createBoxObj = function (text, cX, widthVal) {
            return {
                id: nextBoxId++,
                text: text,
                boundingBox: {
                    centerPerX: cX,
                    centerPerY: bb.centerPerY,
                    perWidth: widthVal,
                    perHeight: bb.perHeight
                },
                status: box.status,
                selected: false,
                mergedIds: box.mergedIds ? box.mergedIds.slice() : [],
                fields: {
                    name: '',
                    village: '',
                    amount: '',
                    phone: ''
                }
            };
        };

        // 1. Left box
        if (leftTokens.length > 0) {
            var leftText = leftTokens.map(function (t) { return t.value; }).join('').trim();
            var leftCenter = leftEdge + leftWidth / 2;
            resultBoxes.push(createBoxObj(leftText, leftCenter, leftWidth));
        }

        // 2. Middle (selected) box
        var midText = midTokens.map(function (t) { return t.value; }).join('').trim();
        var midCenter = leftEdge + leftWidth + midWidth / 2;
        resultBoxes.push(createBoxObj(midText, midCenter, midWidth));

        // 3. Right box
        if (rightTokens.length > 0) {
            var rightText = rightTokens.map(function (t) { return t.value; }).join('').trim();
            var rightCenter = leftEdge + leftWidth + midWidth + rightWidth / 2;
            resultBoxes.push(createBoxObj(rightText, rightCenter, rightWidth));
        }

        return resultBoxes;
    }

    function renderFieldLabels(box, $box) {
        var labelIndex = 0;
        fieldNames.forEach(function (field) {
            if (box.fields[field]) {
                var label = field.charAt(0).toUpperCase() + field.slice(1) + ': ' + box.fields[field];
                var top = 4 + labelIndex * 20;
                var $label = $('<div class="ocr-field-label"></div>').text(label).css({ top: top + 'px' });
                $box.append($label);
                labelIndex++;
            }
        });
        if (box.fields.hastes && box.fields.hastes.length > 0) {
            var hasteNames = box.fields.hastes.map(function (h) { return h.name; }).filter(Boolean).join(', ');
            if (hasteNames) {
                var label = 'Haste: ' + hasteNames;
                var top = 4 + labelIndex * 20;
                var $label = $('<div class="ocr-field-label"></div>').text(label).css({ top: top + 'px' });
                $box.append($label);
            }
        }
    }
    function openImageCropperForCollector(personName, imageUrl) {
        var fu = new frappe.ui.FileUploader({
            allow_multiple: false,
            on_success: function (file_doc) {
                frappe.call({
                    method: 'veerpasli.veerpasli.doctype.pdf_page.pdf_page.set_person_profile',
                    args: {
                        person_name: personName,
                        file_url: file_doc.file_url
                    },
                    callback: function (r) {
                        if (r.exc) {
                            frappe.msgprint('Could not link profile photo to collector. Please set it manually.');
                        } else {
                            frappe.show_alert({ message: 'Collector profile photo saved.', indicator: 'green' });
                        }
                    }
                });
            }
        });

        // Resolve absolute URL so fetch works for private files
        var absoluteUrl = imageUrl;
        if (imageUrl && !imageUrl.startsWith('http')) {
            absoluteUrl = window.location.origin + imageUrl;
        }

        fetch(absoluteUrl, { credentials: 'include' })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.blob();
            })
            .then(function (blob) {
                // Name the file after the person so the profile photo is identifiable
                var safePersonName = personName.replace(/[^\w\s\u0900-\u097F]/g, '').trim().replace(/\s+/g, '_');
                var fileName = (safePersonName || 'collector') + '.png';
                var file = new File([blob], fileName, { type: blob.type || 'image/png' });
                fu.uploader.add_files([file]);
                // Auto-click the crop button after the file is rendered
                setTimeout(function () {
                    var cropBtn = fu.dialog.$body.get(0).querySelector('button.btn-crop');
                    if (cropBtn) {
                        cropBtn.click();
                    }
                }, 600);
            })
            .catch(function (err) {
                console.error('Failed to load image for cropper:', err);
                frappe.msgprint(
                    'Could not load image for cropping. Please set the profile photo manually from the Collector record.'
                );
            });
    }

    function openBoxEditorModal(box) {
        box.fields.hastes = box.fields.hastes || [];
        function deduplicateText(text) {
            if (!text) return '';
            var words = text.trim().split(/\s+/);
            if (words.length % 2 === 0) {
                var mid = words.length / 2;
                var firstHalf = words.slice(0, mid).join(' ');
                var secondHalf = words.slice(mid).join(' ');
                if (firstHalf === secondHalf) {
                    return firstHalf;
                }
            }
            return text;
        }

        box.text = deduplicateText(box.text);
        var tokens;
        var originalBoxText;

        if (box.status === 'verified') {
            // Submitted box: Text box starts empty (no tokens), and we reconstruct originalBoxText for Redo/Reset
            tokens = [];
            var parts = [];
            if (box.fields.name) parts.push(box.fields.name);
            if (box.fields.village) parts.push(box.fields.village);
            if (box.fields.amount) parts.push(box.fields.amount);
            if (box.fields.phone) parts.push(box.fields.phone);
            if (box.fields.hastes && box.fields.hastes.length > 0) {
                box.fields.hastes.forEach(function (h) {
                    if (h.name) parts.push(h.name);
                });
            }
            originalBoxText = parts.join(' ').replace(/\s+/g, ' ').trim();
        } else {
            // Unsubmitted/merged box: Text box shows the current tokens, and originalBoxText is the current box.text
            tokens = tokenizeText(box.text || '', true);
            originalBoxText = box.text || '';
        }
        originalBoxText = deduplicateText(originalBoxText);

        var currentOffset = 0;
        tokens.forEach(function (token) {
            token.start = currentOffset;
            token.end = currentOffset + token.value.length;
            currentOffset = token.end;
        });

        // Rebuild token offsets after any mutation (delete / add)
        function rebuildTokenOffsets() {
            var offset = 0;
            tokens.forEach(function (t) {
                t.start = offset;
                t.end = offset + t.value.length;
                offset = t.end;
            });
        }

        // Sync box.text from the current tokens array
        function rebuildBoxText() {
            box.text = tokens.map(function (t) { return t.value; }).join('');
            rebuildTokenOffsets();
        }

        // Remove a token by its current index in the tokens array
        function deleteToken(tokenIndex) {
            // Adjust selectedTokenIds — preserve click order, shift indices > deleted
            selectedTokenIds = selectedTokenIds
                .filter(function (i) { return i !== tokenIndex; })
                .map(function (i) { return i > tokenIndex ? i - 1 : i; });

            tokens.splice(tokenIndex, 1);
            rebuildBoxText();
            persistJsonData(); // Save updated box.text to DB
            redraw();
        }

        // Add a new token word
        function addNewToken(word) {
            if (!word) return;
            // Ensure the last existing token ends with a space so joining tokens
            // doesn't merge the new word with the previous one (OCR last token
            // often has no trailing whitespace, e.g. "1000" not "1000 ").
            if (tokens.length > 0) {
                var last = tokens[tokens.length - 1];
                if (!/\s$/.test(last.value)) {
                    last.value += ' ';
                }
            }
            var newToken = { value: word + ' ', label: word };
            tokens.push(newToken);
            rebuildBoxText();
            persistJsonData(); // Save updated box.text to DB
            redraw();
        }

        var activeField = null;
        // Ordered array — preserves the exact click sequence so assigned value
        // follows user intent, not token position in the array.
        var selectedTokenIds = [];
        var selectedEntryType = box.fields.entryType || 'Donation';
        if (selectedEntryType.toLowerCase() === 'collector') {
            selectedEntryType = 'Collector';
        } else if (selectedEntryType.toLowerCase() === 'donation') {
            selectedEntryType = 'Donation';
        }

        function renderModalContent() {
            var html = '<div class="ocr-checker-modal">';

            // 1. Entry Type
            html += '<div class="mb-2"><strong>Entry Type</strong></div>';
            html += '<div class="d-flex flex-wrap gap-2 mb-4">';
            ['Donation', 'Collector'].forEach(function (type) {
                var buttonClass = 'btn btn-sm btn-outline-secondary';
                if (selectedEntryType === type) {
                    buttonClass = 'btn btn-sm btn-secondary active';
                }
                html += '<button type="button" class="ocr-entry-type ' + buttonClass + '" data-type="' + type + '">' + type + '</button>';
            });
            html += '</div>';

            // 2. Text Box — box.text only holds unassigned tokens (assigned ones
            // are spliced out on Assign so no filtering needed here)
            html += '<div class="mb-2"><strong>Text Box</strong></div>';

            html += '<div class="ocr-token-container mb-4" style="display: flex; flex-wrap: wrap; align-items: center; padding: 0.5rem; border: 1px solid #dee2e6; border-radius: 4px; background: #fff; min-height: 60px; max-height: 150px; overflow-y: auto; cursor: text;" id="ocrTokenContainer">';
            tokens.forEach(function (token, index) {
                var cssClass = 'ocr-token';
                if (selectedTokenIds.indexOf(index) !== -1) {
                    cssClass += ' ocr-token-selected';
                    if (activeField) {
                        cssClass += ' ocr-token-' + activeField;
                    }
                }
                html += '<span class="' + cssClass + '" data-token-index="' + index + '">';
                html += frappe.utils.escape_html(token.value);
                var selPos = selectedTokenIds.indexOf(index);
                if (selPos !== -1) {
                    html += '<span class="ocr-token-order">' + (selPos + 1) + '</span>';
                }
                html += '<span class="ocr-token-delete" data-delete-index="' + index + '" title="Delete token">&times;</span>';
                html += '</span>';
            });
            if (tokens.length === 0) {
                html += '<span class="text-muted" id="ocrTokenEmptyHint" style="margin-right:4px;">Type to add tokens&hellip;</span>';
            }
            // Inline editable input appended after all tokens
            html += '<input type="text" id="ocrNewTokenInput" class="ocr-token-new-input" placeholder="type &amp; press space" autocomplete="off" />';
            html += '</div>';

            // 3. Tag Selection
            html += '<div class="mb-2"><strong>Tag Selection</strong></div>';
            html += '<div class="d-flex flex-wrap gap-2 mb-4 align-items-center">';
            fieldNames.forEach(function (field) {
                if (selectedEntryType === 'Donation' && field === 'phone') return;
                if (selectedEntryType === 'Collector' && field === 'amount') return;
                // Hide button if the field is already tagged
                if (box.fields[field]) return;

                var buttonClass = 'btn btn-sm btn-outline-primary';
                if (activeField === field) {
                    buttonClass = 'btn btn-sm btn-primary';
                }
                html += '<button type="button" class="ocr-field-select ' + buttonClass + '" data-field="' + field + '">' + field.charAt(0).toUpperCase() + field.slice(1) + '</button>';
            });

            if (selectedEntryType === 'Donation') {
                (box.fields.hastes || []).forEach(function (hasteObj, i) {
                    var fieldKey = 'haste_' + i;
                    // Hide button if this Haste is already tagged
                    if (hasteObj.name) return;

                    var buttonClass = 'btn btn-sm btn-outline-warning';
                    if (activeField === fieldKey) {
                        buttonClass = 'btn btn-sm btn-warning';
                    }
                    var label = 'Haste ' + (i + 1);
                    html += '<button type="button" class="ocr-field-select ' + buttonClass + '" data-field="' + fieldKey + '">' + label + '</button>';
                });
                html += '<button type="button" id="ocrCheckerAddHaste" class="btn btn-sm btn-outline-info">+ Add Haste</button>';
            }
            html += '</div>';

            // 4. Action Buttons (Assign, Cancel)
            html += '<div class="d-flex mb-4" style="border-top: 1px solid #eee; padding-top: 15px; display: flex; align-items: center;">';
            html += '  <button id="ocrCheckerAssignToken" class="btn btn-sm btn-success" style="margin-right: 10px;">Assign</button>';
            html += '  <button id="ocrCheckerClearTokenSelection" class="btn btn-sm btn-secondary">Cancel</button>';
            html += '</div>';

            // 5. Assigned Fields Area
            html += '<div style="background: #f8f9fa; padding: 12px; border-radius: 6px; border: 1px solid #e9ecef;">';
            html += '  <div class="mb-2"><strong>Assigned fields</strong></div>';
            fieldNames.forEach(function (field) {
                if (selectedEntryType === 'Donation' && field === 'phone') return;
                if (selectedEntryType === 'Collector' && field === 'amount') return;
                html += '  <div class="mb-1"><strong>' + field.charAt(0).toUpperCase() + field.slice(1) + ':</strong> ' + (box.fields[field] ? '<code>' + frappe.utils.escape_html(box.fields[field]) + '</code>' : '<span class="text-muted">not set</span>') + '</div>';
            });
            if (selectedEntryType === 'Donation' && box.fields.hastes && box.fields.hastes.length > 0) {
                box.fields.hastes.forEach(function (hasteObj, i) {
                    var valueHtml = hasteObj.name ? '<code>' + frappe.utils.escape_html(hasteObj.name) + '</code>' : '<span class="text-muted">not set</span>';
                    html += '  <div class="mb-1"><strong>Haste ' + (i + 1) + ':</strong> ' + valueHtml + ' <button type="button" class="btn btn-xs btn-link text-danger ocr-remove-haste" data-index="' + i + '" style="padding: 0; margin-left: 5px;">[Remove]</button></div>';
                });
            }
            html += '</div>'; // End assigned fields area

            html += '</div>'; // End container
            return html;
        }

        var dialog = new frappe.ui.Dialog({
            title: 'Tag ' + selectedEntryType,
            fields: [
                { fieldtype: 'HTML', fieldname: 'content' },
                {
                    fieldtype: 'Date',
                    fieldname: 'donation_date',
                    label: 'Donation Date',
                    default: box.fields.donation_date || '2024-08-01'
                }
            ],
            primary_action_label: 'Submit',
            primary_action: submitBoxEntry,
            secondary_action_label: 'Redo / Reset',
            secondary_action: resetAssignments
        });

        if (box.fields.donation_date) {
            dialog.set_value('donation_date', box.fields.donation_date);
        } else {
            dialog.set_value('donation_date', '2024-08-01');
        }

        function submitBoxEntry() {
            if (!selectedEntryType) {
                frappe.msgprint('Select Donation or Collector before submitting.');
                return;
            }

            var missing = [];
            if (!box.fields.name) {
                missing.push('name');
            }
            if (selectedEntryType === 'Donation' && !box.fields.amount) {
                missing.push('amount (for Donation)');
            }
            if (selectedEntryType === 'Collector' && !box.fields.village) {
                missing.push('village (for Collector)');
            }

            if (missing.length) {
                frappe.msgprint('Please assign the following fields: ' + missing.join(', '));
                return;
            }

            var imageUrl = currentImageUrl || getQueryParam('image');
            if (!imageUrl) {
                setStatus('Cannot determine image filename for location parsing.', 'text-danger');
                return;
            }

            dialog.set_primary_action('Submitting...', function () { });

            if (selectedEntryType === 'Donation') {
                box.fields.donation_date = dialog.get_value('donation_date') || '2024-08-01';
            } else {
                box.fields.donation_date = '';
            }

            var entryTypeForBackend = selectedEntryType === 'Collector' ? 'collector' : 'donation';
            var wasVerified = (box.status === 'verified');

            frappe.call({
                method: 'veerpasli.veerpasli.doctype.pdf_page.pdf_page.process_ocr_box',
                args: {
                    image_url: imageUrl,
                    box: JSON.stringify({
                        type: entryTypeForBackend,
                        fields: box.fields,
                        centerPerX: box.boundingBox ? box.boundingBox.centerPerX : null,
                        centerPerY: box.boundingBox ? box.boundingBox.centerPerY : null,
                        perWidth: box.boundingBox ? box.boundingBox.perWidth : null,
                        perHeight: box.boundingBox ? box.boundingBox.perHeight : null
                    }),
                    page_id: pageId
                },
                callback: function (r) {
                    if (r.exc) {
                        setStatus('Unable to create entry: ' + (r.exc && r.exc.message ? r.exc.message : r.message), 'text-danger');
                    } else {
                        box.status = 'verified';
                        box.fields.entryType = selectedEntryType;
                        if (r.message) {
                            box.fields.reference_person = r.message.person || '';
                            box.fields.reference_donation = r.message.donation || '';
                            if (r.message.hastes) {
                                box.fields.hastes = r.message.hastes;
                            }
                        }
                        saveVerifiedBoxToJson(box);
                        renderBoxes();
                        renderControls();
                        setStatus('Created ' + selectedEntryType + ' entry and marked as verified.', 'text-success');
                        dialog.hide();
                        // If this was a Collector, open the image cropper to set the profile photo
                        if (!wasVerified && r.message && r.message.type === 'collector' && r.message.person) {
                            openImageCropperForCollector(r.message.person, currentImageUrl);
                        }
                    }
                },
                always: function () {
                    dialog.set_primary_action('Submit', submitBoxEntry);
                }
            });
        }

        function resetAssignments() {
            fieldNames.forEach(function (field) {
                box.fields[field] = '';
            });
            box.fields.donation_date = '';
            if (dialog.fields_dict.donation_date) {
                dialog.set_value('donation_date', '2024-08-01');
            }
            box.fields.hastes = [];
            box.fields.reference_person = '';
            box.fields.reference_donation = '';
            box.fields.entryType = '';
            box.status = 'merged';
            // Restore box.text and tokens to the state when the modal was first opened
            box.text = originalBoxText;
            tokens.length = 0;
            tokenizeText(originalBoxText, true).forEach(function (t) { tokens.push(t); });
            rebuildTokenOffsets();
            persistJsonData();
            selectedTokenIds.length = 0;
            activeField = null;
            redraw();
            renderBoxes();
            renderControls();
            setStatus('Reset all assignments for this box.', 'text-muted');
        }

        function redraw() {
            dialog.set_title('Tag ' + selectedEntryType);
            if (dialog.fields_dict.donation_date) {
                dialog.set_df_property('donation_date', 'hidden', selectedEntryType !== 'Donation' ? 1 : 0);
            }
            dialog.fields_dict.content.$wrapper.html(renderModalContent());
            dialog.fields_dict.content.$wrapper.find('.ocr-entry-type').on('click', function () {
                selectedEntryType = $(this).attr('data-type');
                redraw();
            });
            dialog.fields_dict.content.$wrapper.find('.ocr-field-select').on('click', function () {
                activeField = $(this).attr('data-field');
                selectedTokenIds.length = 0;
                redraw();
            });

            // Token click: select for field assignment (but not if clicking the delete ×)
            dialog.fields_dict.content.$wrapper.find('.ocr-token').on('click', function (e) {
                // Ignore clicks on the delete button itself
                if ($(e.target).hasClass('ocr-token-delete')) return;
                if (!activeField) return;
                var index = parseInt($(this).attr('data-token-index'), 10);
                var pos = selectedTokenIds.indexOf(index);
                if (pos !== -1) {
                    selectedTokenIds.splice(pos, 1); // deselect, preserve order of others
                } else {
                    selectedTokenIds.push(index);   // select in click order
                }
                redraw();
            });

            // Token delete × button
            dialog.fields_dict.content.$wrapper.find('.ocr-token-delete').on('click', function (e) {
                e.stopPropagation();
                var index = parseInt($(this).attr('data-delete-index'), 10);
                deleteToken(index);
            });

            // Inline new-token input: pressing Space or Enter commits the word as a new token
            var $input = dialog.fields_dict.content.$wrapper.find('#ocrNewTokenInput');
            $input.on('keydown', function (e) {
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    var word = $input.val().trim();
                    if (word) {
                        addNewToken(word);
                    } else {
                        // empty space — just focus stays
                    }
                }
            });
            // Clicking anywhere inside the container focuses the input
            dialog.fields_dict.content.$wrapper.find('#ocrTokenContainer').on('click', function (e) {
                if (e.target === this || $(e.target).is('#ocrTokenEmptyHint')) {
                    $input.focus();
                }
            });
            // Auto-focus if no tokens remain so typing feels natural
            if (tokens.length === 0) {
                setTimeout(function () { $input.focus(); }, 50);
            }

            dialog.fields_dict.content.$wrapper.find('#ocrCheckerAssignToken').on('click', function () {
                if (!activeField) {
                    frappe.msgprint('Choose a field before assigning text.');
                    return;
                }
                if (!selectedTokenIds.length) {
                    frappe.msgprint('Select text tokens before assigning.');
                    return;
                }
                // Build value in the ORDER the user clicked — not token array order
                var assignedValue = selectedTokenIds.map(function (index) {
                    return tokens[index] ? tokens[index].value : '';
                }).join('').trim();

                // Clean up whitespace around hyphens/mdashes/ndashes (e.g. "nirona - chota" -> "nirona-chota")
                assignedValue = assignedValue.replace(/\s*([-—–])\s*/g, '$1');
                // Assign: set the field value then physically remove those tokens from
                // box.text so they never reappear in the text box on next modal open.
                var assignedField = activeField;
                if (assignedField.startsWith('haste_')) {
                    var idx = parseInt(assignedField.split('_')[1], 10);
                    box.fields.hastes[idx].name = assignedValue;
                } else {
                    box.fields[assignedField] = assignedValue;
                }

                // Splice selected tokens out (highest index first to keep lower indices stable)
                var indicesToRemove = selectedTokenIds.slice().sort(function (a, b) { return b - a; });
                indicesToRemove.forEach(function (i) { tokens.splice(i, 1); });
                rebuildBoxText();
                // NOTE: No persistJsonData() here — calling it on every assign creates
                // a race condition where a stale async write can arrive AFTER the
                // submit's saveVerifiedBoxToJson write, resurrecting the old merged box.
                // The final DB write happens in saveVerifiedBoxToJson on submit.

                activeField = null;
                selectedTokenIds.length = 0;
                redraw();
                renderBoxes();
                renderControls();
                setStatus('Tagged text to ' + assignedField + '.', 'text-success');
            });
            dialog.fields_dict.content.$wrapper.find('#ocrCheckerClearTokenSelection').on('click', function () {
                selectedTokenIds.length = 0;
                redraw();
            });
            dialog.fields_dict.content.$wrapper.find('#ocrCheckerAddHaste').on('click', function () {
                if (!box.fields.hastes) {
                    box.fields.hastes = [];
                }
                box.fields.hastes.push({ name: '', reference_person: '' });
                redraw();
            });
            dialog.fields_dict.content.$wrapper.find('.ocr-remove-haste').on('click', function () {
                var index = parseInt($(this).attr('data-index'), 10);
                box.fields.hastes.splice(index, 1);
                if (activeField === 'haste_' + index) {
                    activeField = null;
                } else if (activeField && activeField.startsWith('haste_')) {
                    var actIdx = parseInt(activeField.split('_')[1], 10);
                    if (actIdx > index) {
                        activeField = 'haste_' + (actIdx - 1);
                    }
                }
                redraw();
            });
        }

        dialog.set_primary_action('Submit', submitBoxEntry);

        redraw();
        dialog.show();
    }

    function openSplitModal(box) {
        var tokens = tokenizeText(box.text || '');
        var selectedTokenIds = new Set();

        function renderModalContent() {
            var html = '<div class="ocr-checker-modal">';

            // 1. Text Box Title and Container
            html += '<div class="mb-2"><strong>Text Box</strong></div>';
            html += '<div class="ocr-token-container mb-3" style="padding: 0.75rem; border: 1px solid #dee2e6; border-radius: 4px; background: #fff; max-height: 260px; overflow-y: auto;">';
            tokens.forEach(function (token, index) {
                var cssClass = 'ocr-token';
                if (selectedTokenIds.has(index)) {
                    cssClass += ' ocr-token-selected';
                }
                html += '<span class="' + cssClass + '" data-token-index="' + index + '">' + frappe.utils.escape_html(token.value) + '</span>';
            });
            html += '</div>';

            // 2. Action Buttons (Split, Cancel)
            html += '<div class="d-flex mb-3" style="display: flex; align-items: center;">';
            html += '  <button id="ocrCheckerSplitOnly" class="btn btn-sm btn-success" style="margin-right: 10px;">Split</button>';
            html += '  <button id="ocrCheckerClearTokenSelection" class="btn btn-sm btn-secondary">Cancel</button>';
            html += '</div>';

            // 3. Examples Container
            html += '<div style="background: #f8f9fa; padding: 12px; border-radius: 6px; border: 1px solid #e9ecef; margin-top: 15px; font-size: 12px; line-height: 1.8;">';
            html += '  <div class="mb-2"><strong>Quick Examples:</strong></div>';
            html += '  <div class="mb-2">• <strong>Middle Selection</strong>: <span style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; margin-right: 2px;">A</span> <span style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; margin-right: 2px;">B</span> <span style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px;">C</span>. Select <span style="background: #fff3cd; border: 1px solid #ffeeba; color: #856404; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; font-weight: bold;">B</span> to split into 3 boxes (<span style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px;">A</span>, <span style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px;">B</span>, <span style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px;">C</span>).</div>';
            html += '  <div>• <strong>End Selection</strong>: <span style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; margin-right: 2px;">A</span> <span style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; margin-right: 2px;">B</span> <span style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px;">C</span>. Select <span style="background: #fff3cd; border: 1px solid #ffeeba; color: #856404; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; font-weight: bold;">C</span> to split into 2 boxes (<span style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px;">A B</span>, <span style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px;">C</span>).</div>';
            html += '</div>';

            html += '</div>';
            return html;
        }

        var dialog = new frappe.ui.Dialog({
            title: 'Split Box',
            fields: [
                { fieldtype: 'HTML', fieldname: 'content' }
            ],
            primary_action_label: 'Done',
            primary_action: function () {
                dialog.hide();
            }
        });

        function redraw() {
            dialog.fields_dict.content.$wrapper.html(renderModalContent());

            dialog.fields_dict.content.$wrapper.find('.ocr-token').on('click', function () {
                var index = parseInt($(this).attr('data-token-index'), 10);
                if (selectedTokenIds.has(index)) {
                    selectedTokenIds.delete(index);
                } else {
                    selectedTokenIds.add(index);
                }
                redraw();
            });
            dialog.fields_dict.content.$wrapper.find('#ocrCheckerSplitOnly').on('click', function () {
                if (!selectedTokenIds.size) {
                    frappe.msgprint('Select tokens before splitting the box.');
                    return;
                }
                var newBoxes = splitBoxByTokenSelection(box, tokens, selectedTokenIds);
                if (!newBoxes || !newBoxes.length) {
                    frappe.msgprint('Cannot split this selection. Choose a contiguous range of tokens and try again.');
                    return;
                }

                // Remove the old box's segments from jsonData.segments
                removeSegmentForBox(box);

                // Remove the old box from the local boxes array
                var oldBoxIndex = boxes.indexOf(box);
                if (oldBoxIndex > -1) {
                    boxes.splice(oldBoxIndex, 1);
                }

                // Add the new boxes to boxes and to jsonData.segments in correct order
                newBoxes.forEach(function (newBox) {
                    newBox.sourceSegments = [{
                        text: newBox.text,
                        boundingBox: newBox.boundingBox
                    }];

                    if (jsonData && Array.isArray(jsonData.segments)) {
                        jsonData.segments.push({
                            text: newBox.text,
                            boundingBox: newBox.boundingBox
                        });
                    }
                    boxes.push(newBox);
                });

                selectedTokenIds.clear();

                // Persist the updated JSON data to the file
                persistJsonData();

                renderBoxes();
                renderControls();
                setStatus('Split the box and updated the JSON file.', 'text-success');
                dialog.hide();
            });
            dialog.fields_dict.content.$wrapper.find('#ocrCheckerClearTokenSelection').on('click', function () {
                selectedTokenIds.clear();
                redraw();
            });
        }



        redraw();
        dialog.show();
    }

    function getBoxEdges(box) {
        var bb = box.boundingBox;
        var left = bb.centerPerX - bb.perWidth / 2;
        var top = bb.centerPerY - bb.perHeight / 2;
        return {
            left: left,
            top: top,
            right: left + bb.perWidth,
            bottom: top + bb.perHeight
        };
    }

    function unionBoundingBox(boxList) {
        var edges = boxList.map(getBoxEdges);
        var left = Math.min.apply(null, edges.map(function (e) { return e.left; }));
        var top = Math.min.apply(null, edges.map(function (e) { return e.top; }));
        var right = Math.max.apply(null, edges.map(function (e) { return e.right; }));
        var bottom = Math.max.apply(null, edges.map(function (e) { return e.bottom; }));

        return {
            centerPerX: (left + right) / 2,
            centerPerY: (top + bottom) / 2,
            perWidth: right - left,
            perHeight: bottom - top
        };
    }

    function sortBoxesForMerge(boxList) {
        return boxList.slice().sort(function (a, b) {
            var aEdges = getBoxEdges(a);
            var bEdges = getBoxEdges(b);
            if (Math.abs(aEdges.top - bEdges.top) > 0.01) {
                return aEdges.top - bEdges.top;
            }
            return aEdges.left - bEdges.left;
        });
    }

    function allBoxesComplete() {
        return boxes.length > 0 && boxes.every(function (box) {
            return box.status === 'complete';
        });
    }

    function removeSegmentForBox(box) {
        if (!jsonData || !Array.isArray(jsonData.segments)) {
            return false;
        }

        var removed = false;

        var segmentsToRemove = box.sourceSegments || [{
            text: box.text,
            boundingBox: box.boundingBox
        }];

        jsonData.segments = jsonData.segments.filter(function (segment) {

            var shouldRemove = segmentsToRemove.some(function (source) {

                return (
                    segment.text === source.text &&
                    JSON.stringify(segment.boundingBox) ===
                    JSON.stringify(source.boundingBox)
                );
            });

            if (shouldRemove) {
                removed = true;
                return false;
            }

            return true;
        });

        return removed;
    }

    function persistJsonData() {
        if (!pageId && currentImageUrl) {
            var filename = currentImageUrl.split('/').pop().split('?')[0];
            pageId = filename.replace(/\.[^/.]+$/, '');
        }
        if (!pageId) {
            console.error('Cannot persist: Page ID is missing.');
            return;
        }

        frappe.call({
            method: 'veerpasli.veerpasli.doctype.pdf_page.pdf_page.update_ocr_boxes',
            args: {
                page_id: pageId,
                boxes: JSON.stringify(boxes)
            },
            callback: function (r) {
                if (r.exc) {
                    console.error('Failed to update OCR boxes:', r.exc);
                }
            }
        });
    }

    function deleteSelectedBoxes() {
        if (selectedBoxIds.size === 0) {
            return;
        }

        boxes = boxes.filter(function (box) {
            if (selectedBoxIds.has(box.id)) {
                removeSegmentForBox(box);
                return false;
            }
            return true;
        });

        selectedBoxIds.clear();
        persistJsonData();
        renderBoxes();
        renderControls();
        setStatus('Deleted selected box(es).', 'text-success');
    }

    function renderControls() {
        var selectedCount = selectedBoxIds.size;
        $selectedCount.text(selectedCount);
        $mergeBtn.prop('disabled', selectedCount < 2);
        $deleteBtn.prop('disabled', selectedCount === 0);
        $clearSelectionBtn.prop('disabled', selectedCount === 0);

        if (allBoxesVerified() && (!jsonData || jsonData.status !== 'verified')) {
            $verifyPageBtn.removeClass('d-none');
        } else {
            $verifyPageBtn.addClass('d-none');
        }
    }

    function allBoxesVerified() {
        return boxes.length > 0 && boxes.every(function (box) {
            return box.status === 'verified';
        });
    }


    function onBoxClick(boxId) {
        var box = boxes.find(function (item) { return item.id === boxId; });
        if (!box) {
            return;
        }

        if (box.status === 'merged' || box.status === 'complete' || box.status === 'verified') {
            selectedBoxIds.clear();
            boxes.forEach(function (item) { item.selected = false; });
            renderBoxes();
            renderControls();
            openBoxEditorModal(box);
            return;
        }

        box.selected = !box.selected;
        if (box.selected) {
            selectedBoxIds.add(box.id);
        } else {
            selectedBoxIds.delete(box.id);
        }

        renderBoxes();
        renderControls();
    }

    function mergeSelectedBoxes() {
        if (selectedBoxIds.size < 2) {
            return;
        }

        var selectedBoxes = boxes.filter(function (box) {
            return selectedBoxIds.has(box.id);
        });

        if (selectedBoxes.length < 2) {
            return;
        }

        selectedBoxes = sortBoxesForMerge(selectedBoxes);
        var mergedText = selectedBoxes.map(function (box) { return box.text.trim(); }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        var mergedBox = {
            id: nextBoxId++,
            text: mergedText,
            boundingBox: unionBoundingBox(selectedBoxes),
            status: 'merged',
            selected: false,
            mergedIds: selectedBoxes.map(function (box) { return box.id; }),
            sourceSegments: [],
            fields: {
                name: '',
                village: '',
                amount: '',
                phone: '',
                donation_date: ''
            }
        };

        selectedBoxes.forEach(function (box) {
            if (box.sourceSegments) {
                mergedBox.sourceSegments =
                    mergedBox.sourceSegments.concat(box.sourceSegments);
            } else {
                mergedBox.sourceSegments.push({
                    text: box.text,
                    boundingBox: box.boundingBox
                });
            }
        });

        boxes = boxes.filter(function (box) {
            return !selectedBoxIds.has(box.id);
        });

        boxes.push(mergedBox);
        selectedBoxIds.clear();
        persistJsonData();
        renderBoxes();
        renderControls();
        setStatus('Merged ' + selectedBoxes.length + ' boxes.', 'text-success');
    }

    function syncOverlaySize() {
        var imgEl = $image[0];
        if (!imgEl) return;
        var renderedWidth = imgEl.offsetWidth;
        var renderedHeight = imgEl.offsetHeight;
        if (renderedWidth && renderedHeight) {
            $overlay.css({
                width: renderedWidth + 'px',
                height: renderedHeight + 'px'
            });
        }
    }

    function renderBoxes() {
        $overlay.empty();
        var imgEl = $image[0];
        var naturalWidth = imgEl.naturalWidth;
        var naturalHeight = imgEl.naturalHeight;
        if (!naturalWidth || !naturalHeight) {
            return;
        }

        // Sync overlay to match the actual rendered image size
        syncOverlaySize();

        var segments = boxes.filter(function (box) {
            return box && box.boundingBox;
        });

        $segmentCount.text(segments.length + ' boxes');

        segments.forEach(function (box) {
            var bb = box.boundingBox;
            if (
                bb.centerPerX == null ||
                bb.centerPerY == null ||
                bb.perWidth == null ||
                bb.perHeight == null
            ) {
                return;
            }

            var left = (bb.centerPerX - bb.perWidth / 2) * 100;
            var top = (bb.centerPerY - bb.perHeight / 2) * 100;
            var boxWidth = bb.perWidth * 100;
            var boxHeight = bb.perHeight * 100;

            var $box = $(
                '<div class="ocr-box" title="' + frappe.utils.escape_html(box.text || '') + '"></div>'
            );
            $box.css({
                left: left + '%',
                top: top + '%',
                width: boxWidth + '%',
                height: boxHeight + '%',
                pointerEvents: 'auto'
            });

            $box.addClass(
                box.status === 'verified' ? 'ocr-box-verified' :
                    box.status === 'complete' ? 'ocr-box-complete' :
                        box.status === 'merged' ? 'ocr-box-merged' :
                            'ocr-box-original'
            );

            if (box.selected && box.status !== 'verified') {
                $box.addClass('ocr-box-selected');
                var $splitIcon = $(
                    '<button class="ocr-box-split-icon" type="button" title="Split box">' +
                    '<img src="/assets/veerpasli/icons/scissor.svg" style="width: 100%; height: 100%; display: block;" />' +
                    '</button>'
                );
                $splitIcon.on('click', function (event) {
                    event.stopPropagation();
                    openSplitModal(box);
                });
                $box.append($splitIcon);
            }

            $box.on('click', function (event) {
                event.stopPropagation();
                onBoxClick(box.id);
            });

            $overlay.append($box);
        });
    }

    function saveVerifiedBoxToJson(box) {
        box.status = 'verified';
        persistJsonData();
    }

    function loadFromPageId(incomingPageId) {
        if (!incomingPageId) {
            clearPreview();
            return;
        }

        isDrawingMode = false;
        if ($drawBoxBtn.length) {
            $drawBoxBtn.removeClass('btn-info').addClass('btn-outline-info').text('Draw Box');
        }
        if ($imageWrapper.length) {
            $imageWrapper.removeClass('ocr-drawing-mode');
        }
        $('#ocrTempDrawBox').remove();
        drawnBoxCoords = null;
        if ($processDrawnBoxBtn.length) {
            $processDrawnBoxBtn.hide();
        }

        setStatus('Loading data from Pdf page...', 'text-muted');
        $overlay.empty();
        $segmentCount.text('0 boxes');
        selectedBoxIds.clear();
        boxes = [];
        nextBoxId = 0;
        pageId = incomingPageId;

        frappe.call({
            method: 'veerpasli.veerpasli.doctype.pdf_page.pdf_page.get_ocr_boxes',
            args: {
                page_id: pageId
            },
            callback: function (r) {
                if (r.exc) {
                    setStatus('Failed to load OCR boxes: ' + (r.exc.message || r.message), 'text-danger');
                    return;
                }
                var data = r.message || { boxes: [] };
                jsonData = data;
                var dbBoxes = Array.isArray(data.boxes) ? data.boxes : [];
                currentImageUrl = data.image_url;

                dbBoxes.forEach(function (dbBox) {
                    if (dbBox && dbBox.boundingBox) {
                        var boxObj = createBox(dbBox, dbBox.status || 'original');
                        boxObj.fields = dbBox.fields || boxObj.fields;
                        boxes.push(boxObj);
                    }
                });

                initStyles();

                $image.off('load.autoLoad error.autoLoad');
                $image.one('load.autoLoad', function () {
                    $imageWrapper.show();
                    $image.show();
                    syncOverlaySize();
                    renderBoxes();
                    renderControls();
                    var originalCount = boxes.filter(function (b) { return b.status === 'original'; }).length;
                    var verifiedCount = boxes.filter(function (b) { return b.status === 'verified'; }).length;
                    setStatus('Rendered ' + boxes.length + ' boxes (' + originalCount + ' original, ' + verifiedCount + ' verified).', 'text-success');
                });
                $image.one('error.autoLoad', function () {
                    setStatus('Failed to load image from URL.', 'text-danger');
                });
                if (currentImageUrl) {
                    $image.attr('src', currentImageUrl);
                } else {
                    setStatus('No image URL found for this page.', 'text-danger');
                }
            }
        });
    }

    function loadFromQuery() {
        var pid = null;
        var route = frappe.get_route();

        if (frappe.route_options && frappe.route_options.page_id) {
            pid = frappe.route_options.page_id;
            frappe.route_options = null;
        } else if (getQueryParam('page_id')) {
            pid = getQueryParam('page_id');
        } else if (route && route[0] === 'ocr-checker' && route[1]) {
            // Support URL format: /app/ocr-checker/वीरपसली_2025_90
            pid = decodeURIComponent(route[1]);
        }

        if (pid) {
            if (pageId !== pid || boxes.length === 0) {
                loadFromPageId(pid);
            }
        } else {
            clearPreview();
        }
    }

    $mergeBtn.on('click', mergeSelectedBoxes);
    $deleteBtn.on('click', deleteSelectedBoxes);
    $verifyPageBtn.on('click', function () {
        if (!pageId) {
            frappe.msgprint('Page ID is missing.');
            return;
        }

        frappe.call({
            method: 'veerpasli.veerpasli.doctype.pdf_page.pdf_page.mark_pdf_page_verified',
            args: {
                page_id: pageId
            },
            callback: function (r) {
                if (r.exc) {
                    frappe.msgprint('Failed to mark page verified: ' + (r.exc && r.exc.message ? r.exc.message : r.message));
                } else {
                    setStatus('Pdf page marked verified.', 'text-success');
                    if (jsonData) jsonData.status = 'verified';
                    $verifyPageBtn.addClass('d-none');
                }
            }
        });
    });
    $clearSelectionBtn.on('click', function () {
        selectedBoxIds.clear();
        boxes.forEach(function (box) {
            box.selected = false;
        });
        renderBoxes();
        renderControls();
    });

    function getRelativeCoords(event, element) {
        // Get the raw client position from mouse or touch
        var clientX = event.clientX;
        var clientY = event.clientY;
        if (event.touches && event.touches.length > 0) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else if (event.originalEvent && event.originalEvent.touches && event.originalEvent.touches.length > 0) {
            clientX = event.originalEvent.touches[0].clientX;
            clientY = event.originalEvent.touches[0].clientY;
        } else if (event.changedTouches && event.changedTouches.length > 0) {
            clientX = event.changedTouches[0].clientX;
            clientY = event.changedTouches[0].clientY;
        }

        // The imageWrapper is inside zoomContainer which has a CSS transform applied.
        // getBoundingClientRect() already returns the *visual* (post-transform) position,
        // so we subtract the frame's origin and then divide by scale to get image-space coords.
        var frameRect = $frame[0].getBoundingClientRect();
        var scale = (zoomState && zoomState.scale) ? zoomState.scale : 1;
        var translateX = (zoomState && zoomState.translateX) ? zoomState.translateX : 0;
        var translateY = (zoomState && zoomState.translateY) ? zoomState.translateY : 0;

        // Position of the touch relative to the frame's top-left corner
        var relToFrame = {
            x: clientX - frameRect.left,
            y: clientY - frameRect.top
        };

        // Reverse the zoom transform: undo translate then divide by scale
        var imageSpaceX = (relToFrame.x - translateX) / scale;
        var imageSpaceY = (relToFrame.y - translateY) / scale;

        return {
            x: imageSpaceX,
            y: imageSpaceY
        };
    }

    $drawBoxBtn.on('click', function () {
        isDrawingMode = !isDrawingMode;
        if (isDrawingMode) {
            $drawBoxBtn.removeClass('btn-outline-info').addClass('btn-info').text('Cancel Drawing');
            $imageWrapper.addClass('ocr-drawing-mode');
            selectedBoxIds.clear();
            boxes.forEach(function (b) {
                b.selected = false;
            });
            renderBoxes();
            renderControls();
            setStatus('Drawing mode enabled. Click on the image to start drawing a box.', 'text-info');
        } else {
            $drawBoxBtn.removeClass('btn-info').addClass('btn-outline-info').text('Draw Box');
            $imageWrapper.removeClass('ocr-drawing-mode');
            $('#ocrTempDrawBox').remove();
            drawnBoxCoords = null;
            $processDrawnBoxBtn.hide();
            setStatus('Drawing mode disabled.', 'text-muted');
        }
    });

    $imageWrapper.on('mousedown touchstart', function (e) {
        if (!isDrawingMode) return;
        if (e.type === 'touchstart') {
            e.preventDefault();
        }

        var coords = getRelativeCoords(e, $imageWrapper[0]);

        if (!isDrawing) {
            isDrawing = true;
            drawStartX = coords.x;
            drawStartY = coords.y;

            $('#ocrTempDrawBox').remove();

            var $tempBox = $('<div id="ocrTempDrawBox" class="ocr-box-drawing"></div>');
            $tempBox.css({
                left: (drawStartX / $imageWrapper.width()) * 100 + '%',
                top: (drawStartY / $imageWrapper.height()) * 100 + '%',
                width: '0%',
                height: '0%'
            });
            $imageWrapper.append($tempBox);
            $processDrawnBoxBtn.hide();
            setStatus('Drawing: Click again on the image to finish the box.', 'text-info');
        } else {
            isDrawing = false;
            if (drawnBoxCoords && (drawnBoxCoords.perWidth > 0.005 && drawnBoxCoords.perHeight > 0.005)) {
                $processDrawnBoxBtn.show();
                setStatus('Box drawn! Click "Process Box" to run OCR.', 'text-success');
            } else {
                $('#ocrTempDrawBox').remove();
                drawnBoxCoords = null;
                $processDrawnBoxBtn.hide();
                setStatus('Drawn box was too small. Click to start drawing again.', 'text-warning');
            }
        }
    });

    $(document).on('mousemove touchmove', function (e) {
        if (!isDrawingMode || !isDrawing) return;

        var coords = getRelativeCoords(e, $imageWrapper[0]);
        var currentX = Math.max(0, Math.min(coords.x, $imageWrapper.width()));
        var currentY = Math.max(0, Math.min(coords.y, $imageWrapper.height()));

        var left = Math.min(drawStartX, currentX);
        var top = Math.min(drawStartY, currentY);
        var width = Math.abs(drawStartX - currentX);
        var height = Math.abs(drawStartY - currentY);

        var wrapperW = $imageWrapper.width();
        var wrapperH = $imageWrapper.height();

        $('#ocrTempDrawBox').css({
            left: (left / wrapperW) * 100 + '%',
            top: (top / wrapperH) * 100 + '%',
            width: (width / wrapperW) * 100 + '%',
            height: (height / wrapperH) * 100 + '%'
        });

        drawnBoxCoords = {
            centerPerX: (left + width / 2) / wrapperW,
            centerPerY: (top + height / 2) / wrapperH,
            perWidth: width / wrapperW,
            perHeight: height / wrapperH
        };
    });

    $processDrawnBoxBtn.on('click', function () {
        if (!drawnBoxCoords) return;

        // Show loading state on the button
        $processDrawnBoxBtn
            .prop('disabled', true)
            .html('<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Running OCR…');

        setStatus('Processing OCR on selected area...', 'text-warning');

        frappe.call({
            method: 'veerpasli.veerpasli.doctype.pdf_page.pdf_page.ocr_crop',
            args: {
                page_id: pageId,
                box: JSON.stringify(drawnBoxCoords)
            },
            callback: function (r) {
                // Restore button
                $processDrawnBoxBtn.prop('disabled', false).text('Process Box');
                if (r.exc) {
                    setStatus('OCR processing failed: ' + (r.exc.message || r.message), 'text-danger');
                    return;
                }

                var result = r.message;
                if (result && result.boundingBox) {
                    var newBox = createBox({
                        text: result.text || '',
                        boundingBox: result.boundingBox,
                        status: 'original'
                    }, 'original');

                    boxes.push(newBox);

                    if (jsonData && Array.isArray(jsonData.segments)) {
                        jsonData.segments.push({
                            text: newBox.text,
                            boundingBox: newBox.boundingBox
                        });
                    }

                    persistJsonData();
                    renderBoxes();
                    renderControls();

                    setStatus('Successfully processed crop: "' + (newBox.text || '(empty)') + '"', 'text-success');

                    $('#ocrTempDrawBox').remove();
                    drawnBoxCoords = null;
                    $processDrawnBoxBtn.hide();

                    // Automatically switch off drawing mode
                    isDrawingMode = false;
                    $drawBoxBtn.removeClass('btn-info').addClass('btn-outline-info').text('Draw Box');
                    $imageWrapper.removeClass('ocr-drawing-mode');
                } else {
                    setStatus('No text found in selected area.', 'text-warning');
                }
            },
            error: function () {
                $processDrawnBoxBtn.prop('disabled', false);
                setStatus('Error communicating with OCR server.', 'text-danger');
            }
        });
    });

    $(document).on('keydown.ocrChecker', function (event) {
        var key = event.key ? event.key.toLowerCase() : '';
        if ((event.ctrlKey || event.metaKey) && key === 'm') {
            event.preventDefault();
            mergeSelectedBoxes();
        }
    });

    frappe.pages['ocr-checker'].on_page_show = function () {
        loadFromQuery();
    };

    clearPreview();
    // Use setTimeout to ensure route is fully resolved by frappe before parsing
    setTimeout(function () {
        loadFromQuery();
    }, 100);

    // ── Responsive: re-render boxes on resize / orientation change ──
    var resizeTimer = null;
    function onViewportResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            if ($image[0] && $image[0].naturalWidth) {
                syncOverlaySize();
                renderBoxes();
            }
        }, 150);
    }
    $(window).on('resize.ocrChecker orientationchange.ocrChecker', onViewportResize);

    // Use ResizeObserver for more reliable size tracking
    if (typeof ResizeObserver !== 'undefined') {
        var imgObserver = new ResizeObserver(function () {
            if ($image[0] && $image[0].naturalWidth) {
                syncOverlaySize();
                renderBoxes();
            }
        });
        imgObserver.observe($image[0]);
    }

    // ── Pinch-to-zoom & pan for mobile ──
    var $zoomContainer = $content.find('#ocrCheckerZoomContainer');
    var $frame = $content.find('#ocrCheckerFrame');
    var zoomState = {
        scale: 1,
        translateX: 0,
        translateY: 0,
        initialDistance: 0,
        initialScale: 1,
        isPinching: false,
        isPanning: false,
        lastTouchX: 0,
        lastTouchY: 0,
        pinchMidX: 0,
        pinchMidY: 0
    };

    function applyZoomTransform() {
        // Clamp scale between 1 and 5
        zoomState.scale = Math.max(1, Math.min(5, zoomState.scale));

        // If at scale 1, reset position
        if (zoomState.scale <= 1) {
            zoomState.translateX = 0;
            zoomState.translateY = 0;
        } else {
            // Constrain panning so image doesn't go out of bounds
            var frameRect = $frame[0].getBoundingClientRect();
            var contentWidth = $zoomContainer[0].offsetWidth * zoomState.scale;
            var contentHeight = $zoomContainer[0].offsetHeight * zoomState.scale;

            var maxX = 0;
            var minX = Math.min(0, frameRect.width - contentWidth);
            var maxY = 0;
            var minY = Math.min(0, frameRect.height - contentHeight);

            // Center if content is smaller than frame (rare, but good fallback)
            if (contentWidth < frameRect.width) {
                minX = maxX = (frameRect.width - contentWidth) / 2;
            }
            if (contentHeight < frameRect.height) {
                minY = maxY = (frameRect.height - contentHeight) / 2;
            }

            zoomState.translateX = Math.max(minX, Math.min(maxX, zoomState.translateX));
            zoomState.translateY = Math.max(minY, Math.min(maxY, zoomState.translateY));
        }

        $zoomContainer.css('transform',
            'translate(' + zoomState.translateX + 'px, ' + zoomState.translateY + 'px) scale(' + zoomState.scale + ')'
        );
    }

    function getTouchDistance(t1, t2) {
        var dx = t1.clientX - t2.clientX;
        var dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    var frameEl = $frame[0];
    if (frameEl) {
        // Prevent Frappe page from scrolling when touching inside the image frame
        frameEl.addEventListener('touchstart', function (e) {
            e.stopPropagation();
            // When drawing mode is active, let all touches fall through to the draw handler
            if (isDrawingMode) return;
            if (e.touches.length === 2) {
                e.preventDefault();
                zoomState.isPinching = true;
                zoomState.isPanning = false;
                zoomState.initialDistance = getTouchDistance(e.touches[0], e.touches[1]);
                zoomState.initialScale = zoomState.scale;
            } else if (e.touches.length === 1 && zoomState.scale > 1) {
                // DO NOT preventDefault on touchstart for 1 finger, this allows tapping boxes!
                zoomState.isPanning = true;
                zoomState.isPinching = false;
                zoomState.lastTouchX = e.touches[0].clientX;
                zoomState.lastTouchY = e.touches[0].clientY;
            }
        }, { passive: false, capture: true });

        frameEl.addEventListener('touchmove', function (e) {
            e.stopPropagation();
            // In drawing mode, prevent scroll but let mousemove handler update the preview box
            if (isDrawingMode) {
                e.preventDefault();
                return;
            }
            if (zoomState.isPinching && e.touches.length === 2) {
                e.preventDefault();
                var currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
                var scaleChange = currentDistance / zoomState.initialDistance;
                zoomState.scale = zoomState.initialScale * scaleChange;
                applyZoomTransform();
            } else if (e.touches.length === 1 && zoomState.scale > 1) {
                e.preventDefault();
                if (!zoomState.isPanning) {
                    zoomState.isPanning = true;
                    zoomState.lastTouchX = e.touches[0].clientX;
                    zoomState.lastTouchY = e.touches[0].clientY;
                    return;
                }
                var dx = e.touches[0].clientX - zoomState.lastTouchX;
                var dy = e.touches[0].clientY - zoomState.lastTouchY;
                zoomState.translateX += dx;
                zoomState.translateY += dy;
                zoomState.lastTouchX = e.touches[0].clientX;
                zoomState.lastTouchY = e.touches[0].clientY;
                applyZoomTransform();
            }
        }, { passive: false, capture: true });

        frameEl.addEventListener('touchend', function (e) {
            if (e.touches.length < 2) {
                zoomState.isPinching = false;
            }
            if (e.touches.length === 1 && zoomState.scale > 1) {
                zoomState.isPanning = true;
                zoomState.lastTouchX = e.touches[0].clientX;
                zoomState.lastTouchY = e.touches[0].clientY;
            }
            if (e.touches.length === 0) {
                zoomState.isPanning = false;
            }
        }, { passive: true });

        // Double-tap to reset zoom
        var lastTapTime = 0;
        frameEl.addEventListener('touchend', function (e) {
            if (e.touches.length === 0 && !zoomState.isPinching) {
                var now = Date.now();
                if (now - lastTapTime < 300) {
                    if (zoomState.scale > 1.1) {
                        zoomState.scale = 1;
                        zoomState.translateX = 0;
                        zoomState.translateY = 0;
                    } else {
                        zoomState.scale = 2.5;
                    }
                    applyZoomTransform();
                }
                lastTapTime = now;
            }
        }, { passive: true });
    }
};