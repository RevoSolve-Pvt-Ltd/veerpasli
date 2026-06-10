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

                            <div id="ocrCheckerControls" class="d-flex flex-column flex-md-row align-items-start gap-2 mb-3">
                                <div class="d-flex flex-wrap gap-2">
                                    <button id="mergeBoxesBtn" class="btn btn-primary btn-sm" disabled>Merge selected</button>
                                    <button id="deleteBoxBtn" class="btn btn-danger btn-sm" disabled>Delete selected</button>
                                    <button id="clearSelectionBtn" class="btn btn-secondary btn-sm" type="button">Clear selection</button>
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
    var $selectedCount = $content.find('#ocrCheckerSelectedCount');
    var $detailsCard = $content.find('#ocrCheckerDetails');
    var $detailsBody = $detailsCard.find('.card-body');

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
            .ocr-token { display: inline-block; padding: 0.25rem 0.5rem; margin: 0.2rem; border: 1px solid #dee2e6; background-color: #f8f9fa; border-radius: 4px; transition: all 0.15s ease-in-out; cursor: pointer; font-family: monospace; font-size: 0.95rem; }
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
                phone: ''
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
        var tokens = tokenizeText(box.text || '', true);

        var currentOffset = 0;
        tokens.forEach(function (token) {
            token.start = currentOffset;
            token.end = currentOffset + token.value.length;
            currentOffset = token.end;
        });

        var assignedTokenIndices = {};
        var matchedRanges = [];
        var queries = [];
        if (box.fields.name) queries.push({ key: 'name', value: box.fields.name.trim() });
        if (box.fields.village) queries.push({ key: 'village', value: box.fields.village.trim() });
        if (box.fields.amount) queries.push({ key: 'amount', value: box.fields.amount.trim() });
        if (box.fields.phone) queries.push({ key: 'phone', value: box.fields.phone.trim() });
        (box.fields.hastes || []).forEach(function (h, idx) {
            if (h.name) {
                queries.push({ key: 'haste_' + idx, value: h.name.trim() });
            }
        });

        queries.sort(function (a, b) {
            return b.value.length - a.value.length;
        });

        queries.forEach(function (q) {
            var val = q.value;
            var pos = 0;
            while (true) {
                var idx = (box.text || '').indexOf(val, pos);
                if (idx === -1) break;

                var start = idx;
                var end = idx + val.length;

                var overlaps = matchedRanges.some(function (r) {
                    return (start < r.end && end > r.start);
                });

                if (!overlaps) {
                    matchedRanges.push({ start: start, end: end });
                    var tokenIndices = [];
                    tokens.forEach(function (token, tIdx) {
                        if (token.start >= start && token.end <= end + 1) {
                            tokenIndices.push(tIdx);
                        }
                    });
                    assignedTokenIndices[q.key] = tokenIndices;
                    break;
                }
                pos = idx + 1;
            }
        });

        var activeField = null;
        var selectedTokenIds = new Set();
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

            // 2. Text Box
            html += '<div class="mb-2"><strong>Text Box</strong></div>';
            var assignedTokenSet = new Set();
            Object.keys(assignedTokenIndices).forEach(function (key) {
                (assignedTokenIndices[key] || []).forEach(function (idx) {
                    assignedTokenSet.add(idx);
                });
            });
            var remainingTokens = tokens.filter(function (token, index) {
                return !assignedTokenSet.has(index);
            });

            html += '<div class="ocr-token-container mb-4" style="padding: 0.75rem; border: 1px solid #dee2e6; border-radius: 4px; background: #fff; min-height: 60px; max-height: 150px; overflow-y: auto;">';
            if (remainingTokens.length > 0) {
                remainingTokens.forEach(function (token) {
                    var originalIndex = tokens.indexOf(token);
                    var cssClass = 'ocr-token';
                    if (selectedTokenIds.has(originalIndex)) {
                        cssClass += ' ocr-token-selected';
                        if (activeField) {
                            cssClass += ' ocr-token-' + activeField;
                        }
                    }
                    html += '<span class="' + cssClass + '" data-token-index="' + originalIndex + '">' + frappe.utils.escape_html(token.value) + '</span>';
                });
            } else {
                html += '<span class="text-muted">All text has been assigned to fields.</span>';
            }
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
                { fieldtype: 'HTML', fieldname: 'content' }
            ],
            primary_action_label: 'Submit',
            primary_action: submitBoxEntry,
            secondary_action_label: 'Redo / Reset',
            secondary_action: resetAssignments
        });

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
                    })
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
            box.fields.hastes = [];
            assignedTokenIndices = {};
            selectedTokenIds.clear();
            activeField = null;
            redraw();
            renderBoxes();
            renderControls();
            setStatus('Reset all assignments for this box.', 'text-muted');
        }

        function redraw() {
            dialog.set_title('Tag ' + selectedEntryType);
            dialog.fields_dict.content.$wrapper.html(renderModalContent());
            dialog.fields_dict.content.$wrapper.find('.ocr-entry-type').on('click', function () {
                selectedEntryType = $(this).attr('data-type');
                redraw();
            });
            dialog.fields_dict.content.$wrapper.find('.ocr-field-select').on('click', function () {
                activeField = $(this).attr('data-field');
                selectedTokenIds.clear();
                redraw();
            });
            dialog.fields_dict.content.$wrapper.find('.ocr-token').on('click', function () {
                if (!activeField) {
                    return;
                }
                var index = parseInt($(this).attr('data-token-index'), 10);
                if (selectedTokenIds.has(index)) {
                    selectedTokenIds.delete(index);
                } else {
                    selectedTokenIds.add(index);
                }
                redraw();
            });
            dialog.fields_dict.content.$wrapper.find('#ocrCheckerAssignToken').on('click', function () {
                if (!activeField) {
                    frappe.msgprint('Choose a field before assigning text.');
                    return;
                }
                if (!selectedTokenIds.size) {
                    frappe.msgprint('Select text tokens before assigning.');
                    return;
                }
                var assignedValue = tokens.filter(function (token, index) {
                    return selectedTokenIds.has(index);
                }).map(function (token) {
                    return token.value;
                }).join('').trim();

                // Clean up whitespace around hyphens/mdashes/ndashes (e.g. "nirona - chota" -> "nirona-chota")
                assignedValue = assignedValue.replace(/\s*([-—–])\s*/g, '$1');
                var assignedField = activeField;
                if (assignedField.startsWith('haste_')) {
                    var idx = parseInt(assignedField.split('_')[1], 10);
                    box.fields.hastes[idx].name = assignedValue;
                } else {
                    box.fields[assignedField] = assignedValue;
                }

                assignedTokenIndices[assignedField] = Array.from(selectedTokenIds);

                activeField = null;
                selectedTokenIds.clear();
                redraw();
                renderBoxes();
                renderControls();
                setStatus('Tagged text to ' + assignedField + '.', 'text-success');
            });
            dialog.fields_dict.content.$wrapper.find('#ocrCheckerClearTokenSelection').on('click', function () {
                selectedTokenIds.clear();
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

                delete assignedTokenIndices['haste_' + index];
                var newAssigned = {};
                Object.keys(assignedTokenIndices).forEach(function (key) {
                    if (key.startsWith('haste_')) {
                        var idx = parseInt(key.split('_')[1], 10);
                        if (idx > index) {
                            newAssigned['haste_' + (idx - 1)] = assignedTokenIndices[key];
                        } else {
                            newAssigned[key] = assignedTokenIndices[key];
                        }
                    } else {
                        newAssigned[key] = assignedTokenIndices[key];
                    }
                });
                assignedTokenIndices = newAssigned;

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
            html += '<div class="mb-3"><strong>Split box text</strong></div>';

            html += '<div class="ocr-token-container mb-3" style="padding: 0.75rem; border: 1px solid #dee2e6; border-radius: 4px; background: #fff; max-height: 260px; overflow-y: auto;">';
            tokens.forEach(function (token, index) {
                var cssClass = 'ocr-token';
                if (selectedTokenIds.has(index)) {
                    cssClass += ' ocr-token-selected';
                }
                html += '<span class="' + cssClass + '" data-token-index="' + index + '">' + frappe.utils.escape_html(token.value) + '</span>';
            });
            html += '</div>';
            html += '<div class="mb-3 text-muted">Select the exact text you want to split into a new box, then click <strong>Split selected text</strong>.</div>';
            html += '<div class="d-flex gap-2 mb-3">';
            html += '<button id="ocrCheckerSplitOnly" class="btn btn-sm btn-warning">Split selected text</button>';
            html += '<button id="ocrCheckerClearTokenSelection" class="btn btn-sm btn-secondary">Clear selection</button>';
            html += '</div>';
            html += '</div>';
            return html;
        }

        var dialog = new frappe.ui.Dialog({
            title: 'Split box text',
            fields: [
                { fieldtype: 'HTML', fieldname: 'content' }
            ]
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

        dialog.set_primary_action('Done', function () {
            dialog.hide();
        });

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

        if (allBoxesVerified()) {
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
                phone: ''
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